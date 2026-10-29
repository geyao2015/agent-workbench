import { useEffect, useRef, useState } from "react";

interface UseChatQueueOptions {
  isStreaming: boolean;
  isPaused: boolean;
  isWaitingApproval: boolean;
  isLoadingHistory: boolean;
  onSend: (text: string) => void;
}

export function useChatQueue({
  isStreaming,
  isPaused,
  isWaitingApproval,
  isLoadingHistory,
  onSend,
}: UseChatQueueOptions) {
  const [queued, setQueued] = useState<string[]>([]);
  const queuedRef = useRef<string[]>([]);
  const onSendRef = useRef(onSend);

  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  function replaceQueue(next: string[]) {
    queuedRef.current = next;
    setQueued(next);
  }

  function enqueueMessage(text: string) {
    replaceQueue([...queuedRef.current, text]);
  }

  function removeQueued(index: number) {
    replaceQueue(queuedRef.current.filter((_, itemIndex) => itemIndex !== index));
  }

  function clearQueue() {
    replaceQueue([]);
  }

  useEffect(() => {
    if (isStreaming || isPaused || isWaitingApproval || isLoadingHistory) {
      return;
    }

    const [next, ...rest] = queuedRef.current;

    if (!next) {
      return;
    }

    replaceQueue(rest);
    onSendRef.current(next);
  }, [isStreaming, isPaused, isWaitingApproval, isLoadingHistory]);

  return { queued, enqueueMessage, removeQueued, clearQueue };
}
