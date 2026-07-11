# TODO

Pending tasks for this repository. Add new rows as they come up; remove or
mark them done once completed.

| Task ID | Complexity (1-20) | Story Points | Depends On | Modifies Existing Spec | Title | Description |
| ------- | ------------------ | ------------- | ---------- | ----------------------- | ----- | ------------ |
| T001    | 12                  | 8             | T002       | No                       | Directory comparison tool | Add a tool to compare two directories (recursively) and report the differences: files present only on one side, files present on both sides with different content (via content checksums), and files that match. Surface the result in a dedicated view/page reachable from the dashboard shell's sidebar. |
| T002    | 8                   | 5             | None       | No                       | Directory file checksum registry tool | Add a tool that recursively scans a directory and computes a content checksum (e.g. SHA-256) for every file, producing a registry/manifest (file path + checksum) that can be viewed and exported. Serves as the building block T001 (directory comparison) relies on to detect matching/changed files. |
| T003    | 10                  | 6             | None       | No                       | Video file metadata extraction tool | Add a tool that scans a directory for video files and extracts their metadata (duration, resolution, codec, bitrate, frame rate, container format, file size, creation date, etc.), likely via ffprobe/ffmpeg, and presents/exports the info per file. |
| T004    | 15                  | 10            | None       | No                       | Video/audio transcoding tool | Add a tool to transcode video files into other video and audio formats/codecs (e.g. via ffmpeg), letting the user pick source file(s), target container/codec/quality, run the conversion, and track job progress/completion. |
