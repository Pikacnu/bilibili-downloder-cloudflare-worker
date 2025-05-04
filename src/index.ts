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

		if (header.get('User-Agent') === 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' || true) {
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
	},
} satisfies ExportedHandler<Env>;
