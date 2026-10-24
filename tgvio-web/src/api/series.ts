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

/** One film of a TMDB collection; place is where it is here ("." the folder itself), empty when missing. */
export interface FilmPart {
  id: number;
  title: string;
  original?: string;
  year?: number;
  release?: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
  rating?: number;
  place?: string;
  released: boolean;
  /** "movie" or "tv": a shelf holds series too. */
  kind?: string;
}

/**
 * What a folder of films is: the TMDB collection its films belong to (福尔摩斯小姐（系列）),
 * one film of none ("film"), or a shelf of several titles ("shelf", 周星驰电影合集).
 */
export interface Films {
  kind: "collection" | "film" | "shelf";
  /** The folder's own film, when the folder is one. */
  film?: FilmPart;
  id: number;
  name: string;
  overview?: string;
  poster?: string;
  backdrop?: string;
  parts: FilmPart[];
}

/** The series page of a folder: a TV series, or the film collection its films belong to; both null when neither. */
export const series = (path: string, password: string) => post<{ series: Series | null; films?: Films | null }>("/tgvio/series", { path, password });
