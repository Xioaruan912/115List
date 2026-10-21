import { post } from "../lib/api";
import type { Poster, SeasonInfo } from "./posters";

export interface SeriesEpisode {
  episode: number;
  name?: string;
  overview?: string;
  /** Still image URL (server path). */
  still?: string;
  air?: string;
  /** Minutes. */
  runtime?: number;
  rating?: number;
  /** The file of the folder that is this episode. */
  file?: string;
}

export interface SeriesSeason extends SeasonInfo {
  /** The season's folder inside this one (a series' own folder). */
  folder?: string;
}

export interface Series {
  base: Poster;
  subject: Poster;
  /** 0 for the series' own folder of season folders. */
  season: number;
  seasons: SeriesSeason[];
  episodes: SeriesEpisode[];
  extra: string[] | null;
  /** The series' own folder above this season folder, as the user sees it. */
  root: string;
}

/** The series page of a folder; series is null when the folder is no TV series. */
export const series = (path: string, password: string) => post<{ series: Series | null }>("/tgvio/series", { path, password });
