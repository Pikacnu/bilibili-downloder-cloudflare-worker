import { BilibiliResponse, BilibiliVideoIdType, BilibiliVideoInfo, VideoPlayInfo, VideoQuality } from './type';

const headers = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
	'Accept-Language': 'zh-CN,zh;q=0.9',
	'Accept-Encoding': 'gzip, deflate, br',
	Connection: 'keep-alive',
	Referer: 'https://www.bilibili.com/',
	Origin: 'https://www.bilibili.com',
};

const API_URL = 'https://api.bilibili.com';
const SliceSize = 1024 * 1024 * 40;

export async function getMediaDataList(links: string[]): Promise<Promise<Record<number, ArrayBuffer>>[]> {
	const sourceResponse = await fetch(links[0], {
		headers: headers,
	});

	const sourceLength = Number(sourceResponse.headers.get('Content-Length')) || 0;
	const sliceCount = Math.ceil(sourceLength / SliceSize);
	const slices: Promise<Record<number, ArrayBuffer>>[] = Array(sliceCount)
		.fill(0)
		.map(async (_, index) => {
			const start = index * SliceSize;
			const end = Math.min(start + SliceSize - 1, sourceLength - 1);

			try {
				return getDashPart(links, {
					start,
					end,
					index,
				});
			} catch (error) {
				console.error(`Video Slice ${index + 1}/${sliceCount} Download Failed:\n`, error);
				throw error;
			}
		});
	return slices;
}

export async function getDashPart(
	urls: string[],
	data: {
		start: number;
		end: number;
		index: number;
	}
): Promise<Record<number, ArrayBuffer>> {
	const urlList: string[] = [...urls];
	let retryCount = 3;
	let url = urlList.shift()!;
	while (true) {
		try {
			console.log(`Downloading slice ${data.index + 1} from ${url}`);
			const response = await fetch(url, {
				headers: {
					...headers,
					Range: `bytes=${data.start}-${data.end}`,
				},
			});
			if (!response.ok) {
				throw new Error(`Error downloading slice ${data.index + 1}: ${response.status}`);
			}
			const buffer = await response.arrayBuffer();
			return {
				[data.index]: buffer,
			};
		} catch (error) {
			if (urlList.length > 0) {
				url = urlList.shift()!;
			} else {
				retryCount--;
				if (retryCount > 0) {
					urlList.push(...urls);
					url = urlList.shift()!;
					continue;
				}
				throw new Error(`All URLs failed: ${error}`);
			}
		}
	}
}

export function processMediaDataList(mediaDataList: Record<number, ArrayBuffer>[]): ReadableStream {
	const sortedDataList = mediaDataList.sort((a, b) => {
		const aIndex = Object.keys(a)[0];
		const bIndex = Object.keys(b)[0];
		return Number(aIndex) - Number(bIndex);
	});
	const readStream = new ReadableStream({
		start(controller) {
			for (const data of sortedDataList) {
				const buffer = Object.values(data)[0];
				controller.enqueue(new Uint8Array(buffer));
			}
			controller.close();
		},
	});
	return readStream;
}

export async function BiliBilifetch(url: string | URL, requestInit?: RequestInit): Promise<any> {
	const response = await fetch(url, requestInit);
	if (!response.ok) {
		throw new Error(`Error fetching data: ${response.status} ${response.statusText} \n body : ${await response.text()}`);
	}
	const data = (await response.json()) as BilibiliResponse<any>;
	const code = Math.abs(data.code || 0); // Default to 0 if code is not present
	switch (true) {
		case [0, 200].includes(data.code):
			return data.data;
		case code === 400:
			throw new Error(`Bad Request: ${data.message} ${url}`);
		case code === 404:
			throw new Error(`Not Found: ${data.message} ${url}`);
		case [352, 412].includes(code):
			throw new Error(`Be Rick Control: ${data.message} ${url}`);
		case [10403, 688, 6002003].includes(code):
			throw new Error(`Area Limit: ${data.message} ${url}`);
		default:
			console.error(data);
			throw new Error(`Unexpected error: ${data.message}`);
	}
}

export async function getVideoInfo(idType: BilibiliVideoIdType, id: string): Promise<BilibiliVideoInfo> {
	const url =
		idType === BilibiliVideoIdType.bvid ? `${API_URL}/x/web-interface/view?bvid=${id}` : `${API_URL}/x/web-interface/view?aid=${id}`;
	const data = await BiliBilifetch(url, {
		headers: headers,
	});
	return data;
}

export function getIdType(id: string) {
	if (isValidBVID(id)) return BilibiliVideoIdType.bvid;
	if (isValidAVID(id)) return BilibiliVideoIdType.avid;
	if (id.startsWith('ss')) return BilibiliVideoIdType.season;
	if (id.startsWith('ep')) return BilibiliVideoIdType.episode;
	return BilibiliVideoIdType.unknown;
}

export function isValidBVID(bvid: string): boolean {
	// BVID 格式: BV 開頭，後面跟著 10 個字元（字母和數字）
	const bvidRegex = /^BV[a-zA-Z0-9]{10}$/;
	return bvidRegex.test(bvid);
}

export function isValidAVID(avid: string): boolean {
	// AVID 格式: AV 開頭，後面跟著 1 到 10 個數字
	const avidRegex = /^AV\d{1,15}$/;
	return avidRegex.test(avid);
}

export async function getVideoPlayInfo(platform = 'dash', bvid: string, videoInfo: BilibiliVideoInfo): Promise<VideoPlayInfo> {
	let url;
	if (platform === 'dash') {
		url = `${API_URL}/x/player/wbi/playurl?bvid=${bvid}&cid=${videoInfo?.cid}&fnver=0&fnval=4048&fourk=1`;
	} else {
		url = `${API_URL}/x/player/wbi/playurl?bvid=${bvid}&cid=${videoInfo?.cid}&platfrom=html5&qn=${VideoQuality._720P}&high_quality=1`;
	}
	const data = await BiliBilifetch(url, {
		headers: headers,
	});
	return data;
}
