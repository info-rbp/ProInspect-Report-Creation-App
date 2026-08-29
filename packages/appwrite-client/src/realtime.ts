import type { Realtime, RealtimeResponseEvent, RealtimeSubscription } from 'appwrite';

export function subscribeToOperationalChannels(
  realtime: Realtime,
  channels: string[],
  onEvent: (event: RealtimeResponseEvent<unknown>) => void,
): Promise<RealtimeSubscription> {
  if (!channels.length) throw new Error('At least one explicit Realtime channel is required.');
  return realtime.subscribe(channels, onEvent);
}
