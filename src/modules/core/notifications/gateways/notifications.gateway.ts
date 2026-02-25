import { Logger } from '@nestjs/common';
import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { LeagueMember } from '@/modules/core/leagues/entities/league-member.entity';

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

  constructor(
    config: ConfigService,
    @InjectRepository(LeagueMember)
    private readonly leagueMemberRepo: Repository<LeagueMember>,
  ) {
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

  /**
   * Emit a league-scoped event to all sockets subscribed to that league's room.
   * Best-effort: never throws.
   */
  emitToLeague(leagueId: string, event: string, payload: unknown): boolean {
    const room = `league:${leagueId}`;
    if (!this.server?.sockets) {
      this.logger.warn(
        `WS league emit skipped: server not ready, event=${event} leagueId=${leagueId}`,
      );
      return false;
    }
    this.server.to(room).emit(event, payload);
    this.logger.log(`WS league emit: event=${event} room=${room}`);
    return true;
  }

  /**
   * Client emits { leagueId } to subscribe to live league activity.
   * Validates JWT (already done on connect) and league membership.
   * On success: socket joins room `league:{leagueId}`.
   * On failure: emits error event back to the socket.
   */
  @SubscribeMessage('league:subscribe')
  async handleLeagueSubscribe(
    client: Socket,
    @MessageBody() data: { leagueId?: string },
  ): Promise<void> {
    const userId = (client as any).userId as string | undefined;
    const leagueId = data?.leagueId;

    if (!userId) {
      client.emit('error', { code: 'UNAUTHORIZED', message: 'Not authenticated' });
      return;
    }
    if (!leagueId || typeof leagueId !== 'string') {
      client.emit('error', { code: 'BAD_REQUEST', message: 'leagueId is required' });
      return;
    }

    try {
      const member = await this.leagueMemberRepo.findOne({
        where: { leagueId, userId },
      });

      if (!member) {
        client.emit('error', {
          code: 'LEAGUE_FORBIDDEN',
          message: 'You are not a member of this league',
        });
        return;
      }

      await client.join(`league:${leagueId}`);
      client.emit('league:subscribed', { leagueId });
      this.logger.log(`WS league subscribe: userId=${userId} leagueId=${leagueId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`WS league subscribe error: ${msg}`);
      client.emit('error', { code: 'INTERNAL_ERROR', message: 'Subscription failed' });
    }
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
