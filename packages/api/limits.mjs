import { createHmac, randomBytes } from 'node:crypto';
import { AppError } from './errors.mjs';

export function createRateLimiter(limits) {
  const buckets = new Map();
  const salt = randomBytes(32);
  const pseudonym = (value) => createHmac('sha256', salt).update(value).digest('hex');
  function take(key, maximum, now) {
    for (const [existingKey, value] of buckets) {
      if (now >= value.endsAt) buckets.delete(existingKey);
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= limits.rateBucketLimit)
        throw new AppError(429, 'RATE_LIMIT', 'The local service is busy. Try again shortly.');
      bucket = { count: 0, endsAt: now + limits.rateWindowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= maximum)
      throw new AppError(429, 'RATE_LIMIT', 'Too many requests. Wait before trying again.');
    bucket.count++;
  }
  return {
    check({ address, userId, endpoint, now = Date.now() }) {
      // Forwarded IP headers are deliberately ignored in the loopback deployment.
      const ip = pseudonym(address ?? 'unknown');
      take(`ip:${ip}`, limits.ipRequestsPerWindow, now);
      take(`endpoint:${ip}:${endpoint}`, limits.endpointRequestsPerWindow, now);
      if (userId) take(`user:${pseudonym(userId)}`, limits.userRequestsPerWindow, now);
    },
  };
}
