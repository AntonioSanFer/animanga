import type { Context } from "hono";
import { FFMPEG, UA } from "./config";
import { contentDisposition } from "./files";
import type { AnimeStream } from "./sources/hianime";
import { animeOrdered, tryProviders } from "./sources/registry";

let activeStreams = 0;
const MAX_STREAMS = Number(process.env.MAX_STREAMS || 3);

export async function animeStreamResponse(
  c: Context,
  episodeId: string,
  lang: "sub" | "dub",
  downloadName?: string,
  provider?: string,
): Promise<Response> {
  if (activeStreams >= MAX_STREAMS) return c.json({ error: "Too many streams playing. Try again shortly." }, 429);

  let stream: AnimeStream;
  try {
    ({ result: stream } = await tryProviders(animeOrdered(provider), (p) => p.stream(episodeId, lang)));
  } catch (err: any) {
    return c.json({ error: err?.message || "Could not resolve stream" }, 502);
  }

  if (!stream.url.startsWith("https://") || stream.url.startsWith("-")) {
    console.error("[stream] rejected non-https stream url");
    return c.json({ error: "Could not start the video stream" }, 502);
  }

  const args = [
    FFMPEG,
    "-loglevel",
    "error",
    "-user_agent",
    UA,
    "-referer",
    stream.referer,
    "-allowed_extensions",
    "ALL",
    "-allowed_segment_extensions",
    "ALL",
    "-extension_picky",
    "0",
    "-protocol_whitelist",
    "http,https,tcp,tls,crypto",
    "-headers",
    `Origin: ${stream.referer.replace(/\/$/, "")}\r\n`,
    "-i",
    stream.url,
    "-c",
    "copy",
    // ponytail: HLS carries AAC in ADTS framing; MP4 needs ASC or the muxer aborts on the first audio packet (~1s of video, then stall).
    "-bsf:a",
    "aac_adtstoasc",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1",
  ];

  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch {
    return c.json({ error: "ffmpeg is not installed on the server" }, 503);
  }

  activeStreams++;
  let closed = false;
  const release = () => {
    if (closed) return;
    closed = true;
    activeStreams--;
    try {
      proc.kill();
    } catch {}
  };
  c.req.raw.signal.addEventListener("abort", release, { once: true });
  proc.exited.finally(release);

  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  let first: Awaited<ReturnType<typeof reader.read>>;
  try {
    first = await Promise.race([
      reader.read(),
      Bun.sleep(20_000).then(() => ({ done: true as const, value: undefined })),
    ]);
  } catch {
    release();
    return c.json({ error: "Stream failed" }, 502);
  }

  if (first.done || !first.value) {
    release();
    let detail = "";
    try {
      const errReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
      const chunk = await errReader.read();
      if (chunk.value) detail = new TextDecoder().decode(chunk.value).slice(0, 300);
    } catch {}
    if (detail) console.error("[stream] ffmpeg failed:", detail);
    return c.json({ error: "Could not start the video stream" }, 502);
  }

  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (downloadName) headers["Content-Disposition"] = contentDisposition(downloadName);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first.value);
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
          controller.close();
        } catch {
          try {
            controller.error(new Error("Stream error"));
          } catch {}
        } finally {
          release();
        }
      })();
    },
    cancel() {
      release();
    },
  });

  return new Response(body, { status: 200, headers });
}
