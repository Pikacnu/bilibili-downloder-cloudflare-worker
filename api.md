# API Documentation for `index.ts`

## Overview

This file defines the main entry point for the Cloudflare Worker. It handles HTTP requests, processes video data, and interacts with Cloudflare KV storage. Below is a detailed explanation of the API endpoints and their functionality.

---

## Endpoints

### `GET /video_data/{videoId}`

#### Description
Fetches video data for the given `videoId`. If the data is not cached in KV storage, it retrieves the video information and play links from the Bilibili API, caches it, and streams the video.

#### Request
- **Path Parameters**:
  - `videoId` (string): The ID of the video (BV or AV format).
- **Headers**:
  - `User-Agent`: Should include `Discordbot/2.0` for compatibility.

#### Response
- **200 OK**: Streams the video as an MP4 file.
  - **Headers**:
    - `Content-Type`: `video/mp4`
    - `Content-Disposition`: `attachment; filename="{videoId}.mp4"`
- **400 Bad Request**: If `videoId` is missing.
- **404 Not Found**: If no video links are found.

---

### `PUT /`

#### Description
Stores video links in KV storage for a given `bvid`.

#### Request
- **Headers**:
  - `x-bvid` (string): The Bilibili video ID.
  - `x-video-links` (string): A pipe-separated (`|`) list of video URLs.
- **Response**:
  - **200 Success Put**: If the data is successfully stored.
  - **400 Bad Request**: If `x-bvid` or `x-video-links` is missing or invalid.

---

### `PROXY /`

#### Description
Proxies a request to an external URL with custom headers and method.

#### Request
- **Headers**:
  - `x-url` (string): The target URL to proxy the request to.
  - `x-method` (string, optional): The HTTP method (default: `GET`).
  - `x-body` (string, optional): The request body (required for non-`GET` methods).
- **Response**:
  - **200 OK**: Returns the proxied response.
  - **400 Bad Request**: If `x-url` is missing or if `x-body` is provided for a `GET` request.

---

## Error Handling

- **401 Unauthorized**: Returned if the `x-api-key` header does not match the expected API key in the environment.
- **400 Bad Request**: Returned for invalid or missing parameters in the request.
- **404 Not Found**: Returned if requested video data is not available.

---

## Environment Variables

- `apiKey`: Used to authenticate requests.
- `bililink`: KV namespace binding for storing video data.

---

## Utility Functions

### `getKvValue(env, key)`
Fetches a value from KV storage.

### `setKvValue(env, key, value)`
Stores a value in KV storage.

### `getIdType(videoId)`
Determines the type of video ID (BV or AV).

### `getVideoInfo(idType, videoId)`
Fetches video metadata from the Bilibili API.

### `getVideoPlayInfo(format, videoId, videoInfo)`
Fetches video play information, including URLs and backup URLs.

### `getMediaDataList(videoLinks)`
Downloads video data from the provided links.

### `processMediaDataList(dataList)`
Processes and combines video data into a readable stream.