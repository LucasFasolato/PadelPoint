import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';

type JwtPayload = { sub: string; email: string; role: string };

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/notifications',
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly jwtSecret: string;

  constructor(config: ConfigService) {
    this.jwtSecret = config.get<string>('JWT_SECRET') ?? '';
  }

  handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.warn(`WS auth failed: no token, clientId=${client.id}`);
        client.disconnect(true);
        return;
      }

      const payload = verify(token, this.jwtSecret) as JwtPayload;
      const userId = payload.sub;
      if (!userId) {
        this.logger.warn(
          `WS auth failed: no sub in JWT, clientId=${client.id}`,
        );
        client.disconnect(true);
        return;
      }

      // Join user-specific room
      void client.join(`user:${userId}`);
      (client as any).userId = userId;

      this.logger.log(`WS connected: userId=${userId} clientId=${client.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`WS auth error: ${msg}, clientId=${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    if (userId) {
      this.logger.log(
        `WS disconnected: userId=${userId} clientId=${client.id}`,
      );
    }
  }

  emitToUser(userId: string, event: string, payload: unknown): boolean {
    const room = `user:${userId}`;
    const sockets = this.server?.sockets;
    if (!sockets) {
      this.logger.warn(
        `WS emit skipped: server not ready, event=${event} userId=${userId}`,
      );
      return false;
    }

    this.server.to(room).emit(event, payload);
    this.logger.log(`WS emit: event=${event} room=${room}`);
    return true;
  }

  private extractToken(client: Socket): string | null {
    // Try auth.token first (socket.io handshake), then Authorization header
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    const header = client.handshake.headers?.authorization;
    if (header && header.startsWith('Bearer ')) {
      return header.slice(7);
    }

    return null;
  }
}
