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
import { getIdType, getMediaStream, getVideoInfo, getVideoPlayInfo } from './bilibili';

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
				const readStream = await getMediaStream(videoLinks);
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

		const url = header.get('x-url') || undefined;
		const urls = header.get('x-bundled-urls') || undefined;
		console.log(`Received Request: x-url=${url}, x-urls=${urls}`);
		switch (true) {
			case url !== undefined && url !== '': {
				if (!url) {
					return Response.json({ error: 'Bad Request', message: 'URL header is empty' }, { status: 400 });
				}
				const method = header.get('x-method') || 'GET';
				const body = header.get('x-body');
				if (body) {
					if (method === 'GET') {
						return Response.json({ error: 'Bad Request', message: 'GET method cannot have a body' }, { status: 400 });
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
			case urls !== undefined && urls !== '': {
				if (!urls) {
					console.error('URLs Header is Empty');
					return Response.json({ error: 'Bad Request', message: 'URLs header is empty' }, { status: 400 });
				}
				const urlList = urls.split('|');
				let ranges: Array<Array<[number, number]>>;
				try {
					const rangeHeader = header.get('x-ranges');
					if (rangeHeader) {
						ranges = JSON.parse(rangeHeader) as Array<Array<[number, number]>>;
						if (ranges.length !== urlList.length) {
							console.error('Ranges Length Mismatch');
							return Response.json({ error: 'Bad Request', message: 'Ranges length does not match URLs length' }, { status: 400 });
						} else {
							for (const rangeSet of ranges) {
								for (const range of rangeSet) {
									if (range[0] < 0 || range[1] < range[0]) {
										return Response.json({ error: 'Bad Request', message: 'Invalid range values' }, { status: 400 });
									}
								}
							}
						}
					} else {
						ranges = [];
					}
				} catch {
					console.error('Failed to Parse Ranges Header');
					console.error('Invalid Ranges Header');
				}

				const processedHeaders = new Headers(request.headers);
				processedHeaders.delete('x-bundled-urls');
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
							await response.body?.cancel();
							retry++;
						}
						throw new Error(`Failed to fetch ${targetUrl} after ${retryCount} retries`);
					});
				const status: Array<number> = [];
				const responseBodyLengths: Array<number> = [];
				const responseBodies: Array<Blob> = [];
				const responses = await Promise.allSettled(fetchPromises);

				// Sequential processing to reduce peak CPU and Memory usage
				for (const res of responses) {
					if (res.status !== 'fulfilled' || !res.value.ok) {
						status.push(0);
						responseBodyLengths.push(0);
						responseBodies.push(new Blob());
						if (res.status === 'fulfilled') {
							await res.value.body?.cancel();
						}
						continue;
					}

					const response = res.value;
					status.push(1);
					try {
						const blob = await response.blob();
						responseBodyLengths.push(blob.size);
						responseBodies.push(blob);
					} catch (e) {
						console.error('Failed to read response body', e);
						// Update status to 0 if reading failed
						status[status.length - 1] = 0;
						responseBodyLengths.push(0);
						responseBodies.push(new Blob());
					}
				}

				const statusBuffer = new Uint8Array(Math.ceil(status.length / 8));
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
				return Response.json({ error: 'Bad Request', message: 'No x-url or x-bundled-urls header provided' }, { status: 400 });
		}
	},
} satisfies ExportedHandler<Env>;
