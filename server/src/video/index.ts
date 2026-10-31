// video/ — real files of the ads, outside the world (video §9). Loaded with dynamic import() only: a bench never pays for it.
export { DEFAULT_MAX_DISK_MB, forkRender, OFF_CAPS, openDirector, selectWorthy, VideoDirector, videoDiskCapOf, videoModeOf, WORTHY } from './director.js';
export type { DirectorOptions, RenderHandle, RenderRecord, RenderRunner, VideoMode } from './director.js';
export type { RenderJob, RenderResult } from './worker.js';
export type { VideoCaps } from './caps.js';
