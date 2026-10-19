export type Kind = "manga" | "anime";
export type UserStatus = "pending" | "active" | "blocked";

export interface MangaSummary {
  id: string;
  title: string;
  cover: string | null;
  description: string;
  year: number | null;
  status: string | null;
  tags: string[];
}

export interface Chapter {
  id: string;
  volume: string | null;
  chapter: string | null;
  title: string | null;
  lang: string;
  pages: number;
  group: string | null;
  publishedAt: string | null;
}

export interface ChapterPage {
  id: string;
  volume: string | null;
  chapter: string | null;
  title: string | null;
  lang: string;
  mangaId: string | null;
  mangaTitle: string | null;
  pages: string[];
  downloadId?: number | null;
}

export interface AnimeSummary {
  id: string;
  title: string;
  cover: string | null;
  description: string;
  type: string | null;
  duration: string | null;
  rating: string | null;
  sub: number;
  dub: number;
}

export interface Episode {
  id: string;
  number: string;
  title: string;
}

export interface DownloadJob {
  id: number;
  kind: Kind;
  sourceId: string;
  itemId: string;
  title: string;
  label: string;
  cover: string | null;
  lang: string | null;
  status: "queued" | "downloading" | "done" | "error";
  progress: number;
  size: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Favourite {
  kind: Kind;
  sourceId: string;
  title: string;
  cover: string | null;
  createdAt: number;
}

export interface AppUser {
  email: string;
  name: string | null;
  role: "admin" | "user";
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface Me {
  user: { email: string; name: string | null; image: string | null };
  appUser: AppUser;
}

export interface AiO {
  id: string;
  label: string;
}
