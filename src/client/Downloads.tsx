import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DownloadJob } from "../shared/types";
import { del, errorMessage, formatBytes, useDownloads, useMe } from "./api";
import { Link } from "./router";
import { Cover, Empty, ErrorView, IconTrash, Loading } from "./ui";

const statusLabels: Record<DownloadJob["status"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  done: "Done",
  error: "Error",
};

function DownloadRow({
  job,
  isAdmin,
  onDelete,
  deleting,
}: {
  job: DownloadJob;
  isAdmin: boolean;
  onDelete: (job: DownloadJob) => void;
  deleting: boolean;
}) {
  const watchLang = job.lang === "dub" ? "dub" : "sub";
  return (
    <div className="dl-row">
      <Cover src={job.cover} alt="" className="dl-cover" />
      <div className="dl-info">
        <span className="dl-title" title={job.title}>
          {job.title}
        </span>
        <span className="dl-sub">
          <span className="badge capitalize">{job.kind}</span>
          <span>{job.label}</span>
          <span className={`badge badge-${job.status}`}>{statusLabels[job.status]}</span>
          {job.size !== null && <span>{formatBytes(job.size)}</span>}
        </span>
        <div
          className={`progress${job.status === "done" ? " progress-done" : job.status === "error" ? " progress-error" : ""}`}
          role="progressbar"
          aria-valuenow={job.status === "done" ? 100 : job.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${job.title} ${job.label} download progress`}
        >
          <span style={{ width: `${job.status === "done" ? 100 : job.progress}%` }} />
        </div>
        {job.status === "error" && job.error && <span className="dl-error">{job.error}</span>}
      </div>
      <div className="dl-actions">
        {job.status === "done" && job.kind === "manga" && (
          <>
            <Link className="btn btn-sm" to={`/manga/chapter/${job.itemId}`}>
              Read
            </Link>
            <a className="btn btn-sm btn-ghost" href={`/api/downloads/${job.id}/file`}>
              CBZ
            </a>
          </>
        )}
        {job.status === "done" && job.kind === "anime" && (
          <>
            <Link
              className="btn btn-sm"
              to={`/anime/watch/${job.itemId}?lang=${watchLang}&title=${encodeURIComponent(job.label)}`}
            >
              Play
            </Link>
            <a className="btn btn-sm btn-ghost" href={`/api/downloads/${job.id}/file?dl=1`}>
              MP4
            </a>
          </>
        )}
        {isAdmin && (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={deleting}
            onClick={() => onDelete(job)}
            aria-label={`Delete ${job.title} ${job.label}`}
          >
            <IconTrash />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function DownloadsList({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const downloads = useDownloads();

  const remove = useMutation({
    mutationFn: (job: DownloadJob) => del<{ ok: boolean }>(`/api/downloads/${job.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });

  function confirmDelete(job: DownloadJob) {
    if (!window.confirm(`Delete "${job.title} - ${job.label}"?`)) return;
    remove.mutate(job);
  }

  const items = downloads.data?.items ?? [];

  return (
    <>
      {downloads.isPending && <Loading label="Loading downloads…" />}
      {downloads.isError && <ErrorView error={downloads.error} onRetry={() => downloads.refetch()} />}
      {remove.isError && (
        <p className="form-error" role="alert">
          {errorMessage(remove.error)}
        </p>
      )}
      {downloads.isSuccess && items.length === 0 && (
        <Empty>
          <p>No downloads yet.</p>
          <p>Download a chapter or episode from its detail page.</p>
        </Empty>
      )}
      {items.length > 0 && (
        <div className="list">
          {items.map((job) => (
            <DownloadRow
              key={job.id}
              job={job}
              isAdmin={isAdmin}
              onDelete={confirmDelete}
              deleting={remove.isPending && remove.variables?.id === job.id}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function DownloadsPage() {
  const me = useMe();
  return (
    <>
      <h1>Downloads</h1>
      <DownloadsList isAdmin={me.data?.appUser.role === "admin"} />
    </>
  );
}
