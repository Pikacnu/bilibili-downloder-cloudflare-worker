export function setKvValue(env: Env, key: string, value: string) {
	return env.bililink.put(key, value);
}
export function getKvValue(env: Env, key: string) {
	return env.bililink.get(key);
}

export function deleteKvValue(env: Env, key: string) {
	return env.bililink.delete(key);
}
