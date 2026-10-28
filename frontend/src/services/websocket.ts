import { useSDNStore } from '../stores/sdnStore';

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectInterval = 2500;
  private shouldReconnect = true;
  private pingIntervalId: any = null;

  connect() {
    this.shouldReconnect = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/events`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        useSDNStore.getState().setConnected(true);
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          useSDNStore.getState().handleWebSocketMessage(data);
        } catch (_) {}
      };

      this.ws.onclose = () => {
        useSDNStore.getState().setConnected(false);
        this.stopPing();
        if (this.shouldReconnect) {
          setTimeout(() => this.connect(), this.reconnectInterval);
        }
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (e) {
      setTimeout(() => this.connect(), this.reconnectInterval);
    }
  }

  private startPing() {
    this.stopPing();
    this.pingIntervalId = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, 10000);
  }

  private stopPing() {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsService = new WebSocketService();
