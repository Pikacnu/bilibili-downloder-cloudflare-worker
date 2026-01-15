/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { setKvValue, getKvValue } from './kv';
import { getIdType, getMediaDataList, getVideoInfo, getVideoPlayInfo, processMediaDataList } from './bilibili';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const header = request.headers;
		const apiKey = header.get('x-api-key');
		const retryCount = 3;

		if (header.get('User-Agent') === 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' || true) {
			// StandAlone
			// Discord Media Proxy or for testing
			const path = new URL(request.url).pathname.split('/').slice(1);
			if (path.length === 0) {
				return new Response('Bad Request', { status: 400 });
			}
			if (path[0] === 'video_data') {
				const videoId = path[1];
				if (!videoId) {
					return new Response('Bad Request', { status: 400 });
				}
				let rawVideoData = await getKvValue(env, videoId);
				if (!rawVideoData) {
					const idType = getIdType(videoId);
					const videoInfo = await getVideoInfo(idType, videoId);
					const videoPlayInfo = await getVideoPlayInfo('html5', videoId, videoInfo);
					const durl = videoPlayInfo.durl[0];
					rawVideoData = JSON.stringify([durl.url, durl.backup_url]);
					setKvValue(env, videoId, rawVideoData);
				}
				const videoData = JSON.parse(rawVideoData) as string[];
				const videoLinks = videoData;
				if (!videoLinks || videoLinks.length === 0) {
					return new Response('Not Found', { status: 404 });
				}
				console.time('Video Download');
				const videoDataList = await getMediaDataList(videoLinks);
				const readStream = processMediaDataList(await Promise.all(videoDataList));
				console.timeEnd('Video Download');

				return new Response(readStream, {
					headers: {
						'Content-Type': 'video/mp4',
						'Content-Disposition': `attachment; filename="${videoId}.mp4"`,
					},
				});
			}
		}

		if (apiKey !== env.apiKey) {
			return new Response('Unauthorized', { status: 401 });
		}

		if (header.get('x-bvid')) {
			const bvid = header.get('x-bvid');
			const VideoLinks = header.get('x-video-links')?.split('|');
			if (!VideoLinks || VideoLinks.length === 0) {
				return new Response('Bad Request', { status: 400 });
			}
			if (!bvid) {
				return new Response('Bad Request', { status: 400 });
			}
			await setKvValue(env, bvid, JSON.stringify(VideoLinks));
			return new Response('Success Put', {
				status: 200,
			});
		}

		const url = header.get('x-url');
		const urls = header.get('x-urls');
		switch (true) {
			case url !== undefined: {
				if (!url) {
					return new Response('Bad Request', { status: 400 });
				}
				const method = header.get('x-method') || 'GET';
				const body = header.get('x-body');
				if (body) {
					if (method === 'GET') {
						return new Response('Bad Request', { status: 400 });
					}
				}
				const headers = new Headers(request.headers);
				headers.delete('x-url');
				headers.delete('x-api-key');
				const response = fetch(url, {
					method,
					body,
					headers,
				});
				return response;
			}
			case urls !== undefined: {
				if (!urls) {
					return new Response('Bad Request', { status: 400 });
				}
				const urlList = urls.split('|');
				let ranges: Array<Array<[number, number]>>;
				try {
					const rangeHeader = header.get('x-ranges');
					if (rangeHeader) {
						ranges = JSON.parse(rangeHeader) as Array<Array<[number, number]>>;
						if (ranges.length !== urlList.length) {
							return new Response('Bad Request', { status: 400 });
						} else {
							for (const rangeSet of ranges) {
								for (const range of rangeSet) {
									if (range[0] < 0 || range[1] < range[0]) {
										return new Response('Bad Request', { status: 400 });
									}
								}
							}
						}
					} else {
						ranges = [];
					}
				} catch {
					console.error('Invalid Ranges Header');
				}

				const processedHeaders = new Headers(request.headers);
				processedHeaders.delete('x-urls');
				processedHeaders.delete('x-api-key');
				processedHeaders.delete('x-ranges');

				const fetchPromises = Array(urlList.length)
					.fill(0)
					.map(async (_, index) => {
						const targetUrl = urlList[index];
						const range = ranges && ranges[index];
						const currentHeaders = new Headers(processedHeaders);
						let retry = 0;
						if (range && range.length > 0) {
							const rangeHeaderValue = range.map((r) => `bytes=${r[0]}-${r[1] === -1 ? '' : r[1]}`).join(',');
							currentHeaders.set('Range', rangeHeaderValue);
						}
						while (retry < retryCount) {
							const response = await fetch(targetUrl, {
								method: 'GET',
								headers: currentHeaders,
							});
							if (response.ok) {
								return response;
							}
							retry++;
						}
						throw new Error(`Failed to fetch ${targetUrl} after ${retryCount} retries`);
					});
				const status: Array<number> = [];
				const responseBodyLengths: Array<number> = [];
				const responseBodies: Array<Blob> = [];
				const responses = await Promise.allSettled(fetchPromises);
				const readResponsesPromises = responses.map((res) => {
					if (res.status !== 'fulfilled') {
						status.push(0);
						responseBodyLengths.push(0);
						responseBodies.push(new Blob());
						return;
					}
					const response = res.value;
					if (!response.ok) {
						status.push(0);
						responseBodyLengths.push(0);
						responseBodies.push(new Blob());
						return;
					}
					status.push(1);
					const reader = response.body?.getReader();
					const chunks: Uint8Array[] = [];
					let receivedLength = 0;
					if (!reader) {
						responseBodyLengths.push(0);
						responseBodies.push(new Blob());
						return;
					}
					return reader.read().then(function processResult(result): Promise<void> | void {
						if (result.done) {
							const body = new Uint8Array(receivedLength);
							let position = 0;
							for (const chunk of chunks) {
								body.set(chunk, position);
								position += chunk.length;
							}
							responseBodyLengths.push(receivedLength);
							responseBodies.push(new Blob(chunks));
							return;
						}
						chunks.push(result.value);
						receivedLength += result.value.length;
						return reader.read().then(processResult);
					});
				});
				await Promise.allSettled(readResponsesPromises);

				const statusBuffer = new Uint8Array(status.length % 8 === 0 ? status.length / 8 : Math.floor(status.length / 8) + 1);
				status.forEach((s, i) => {
					if (s === 1) {
						statusBuffer[Math.floor(i / 8)] |= 1 << i % 8;
					}
				});
				const lengthsBuffer = new ArrayBuffer(responseBodyLengths.length * 4);
				const lengthsView = new DataView(lengthsBuffer);
				responseBodyLengths.forEach((length, i) => {
					lengthsView.setUint32(i * 4, length, true);
				});
				const combinedBlobParts: Array<Uint8Array | ArrayBuffer | Blob> = [];
				combinedBlobParts.push(statusBuffer);
				combinedBlobParts.push(lengthsBuffer);
				for (const body of responseBodies) {
					combinedBlobParts.push(body);
				}
				return new Response(new Blob(combinedBlobParts), {
					headers: {
						'Content-Type': 'application/octet-stream',
					},
				});
			}
			default:
				return new Response('Bad Request', { status: 400 });
		}
	},
} satisfies ExportedHandler<Env>;
