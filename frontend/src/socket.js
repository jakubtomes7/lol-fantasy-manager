import { io } from 'socket.io-client';

// URL backendu - v dev módu default na localhost:4000, jde přepsat přes .env
// (VITE_SERVER_URL=http://muj-server:4000)
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

export const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
});

export default socket;
