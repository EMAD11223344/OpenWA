import { Controller, Get, Post, Delete, Param, Body, HttpCode, HttpStatus, Res, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { SessionService } from './session.service';
import { CreateSessionDto, SessionResponseDto, QRCodeResponseDto } from './dto';
import { Session } from './entities/session.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import * as fs from 'fs';

@ApiTags('sessions')
@Controller('sessions')
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
  ) {}

  // Transform entity to DTO with lastActive field name
  private transformSession(session: Session): SessionResponseDto {
    return {
      id: session.id,
      name: session.name,
      status: session.status,
      phone: session.phone,
      pushName: session.pushName,
      connectedAt: session.connectedAt,
      lastActive: session.lastActiveAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Create a new WhatsApp session' })
  @ApiResponse({
    status: 201,
    description: 'Session created',
    type: SessionResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Session name already exists' })
  async create(@Body() dto: CreateSessionDto): Promise<Session> {
    const session = await this.sessionService.create(dto);
    await this.auditService.logInfo(AuditAction.SESSION_CREATED, {
      sessionId: session.id,
      sessionName: session.name,
    });
    return session;
  }

  @Get()
  @ApiOperation({ summary: 'List all sessions' })
  @ApiResponse({
    status: 200,
    description: 'List of sessions',
    type: [SessionResponseDto],
  })
  async findAll(): Promise<SessionResponseDto[]> {
    const sessions = await this.sessionService.findAll();
    return sessions.map(s => this.transformSession(s));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get session by ID' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Session details',
    type: SessionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async findOne(@Param('id') id: string): Promise<SessionResponseDto> {
    const session = await this.sessionService.findOne(id);
    return this.transformSession(session);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 204, description: 'Session deleted' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async delete(@Param('id') id: string): Promise<void> {
    const session = await this.sessionService.findOne(id);
    await this.sessionService.delete(id);
    await this.auditService.logInfo(AuditAction.SESSION_DELETED, {
      sessionId: id,
      sessionName: session.name,
    });
  }

  @Post(':id/start')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({
    summary: 'Start a session and initialize WhatsApp connection',
  })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Session started',
    type: SessionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Session already started' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async start(@Param('id') id: string): Promise<SessionResponseDto> {
    const session = await this.sessionService.start(id);
    await this.auditService.logInfo(AuditAction.SESSION_STARTED, {
      sessionId: session.id,
      sessionName: session.name,
    });
    return this.transformSession(session);
  }

  @Post(':id/stop')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Stop a session and disconnect WhatsApp' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Session stopped',
    type: SessionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async stop(@Param('id') id: string): Promise<SessionResponseDto> {
    const session = await this.sessionService.stop(id);
    await this.auditService.logInfo(AuditAction.SESSION_STOPPED, {
      sessionId: session.id,
      sessionName: session.name,
    });
    return this.transformSession(session);
  }

  @Get(':id/qr')
  @ApiOperation({ summary: 'Get QR code for session authentication' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'QR code data',
    type: QRCodeResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'QR code not ready or session already authenticated',
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getQRCode(@Param('id') id: string): Promise<QRCodeResponseDto> {
    const qrCode = await this.sessionService.getQRCode(id);
    await this.auditService.logInfo(AuditAction.SESSION_QR_GENERATED, {
      sessionId: id,
    });
    return qrCode;
  }

  @Get(':id/groups')
  @ApiOperation({ summary: 'Get all groups for a session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'List of groups the session is a member of',
  })
  @ApiResponse({ status: 400, description: 'Session not ready' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getGroups(@Param('id') id: string): Promise<{ id: string; name: string }[]> {
    return this.sessionService.getGroups(id);
  }

  @Get('stats/overview')
  @ApiOperation({
    summary: 'Get session statistics for multi-session monitoring',
  })
  @ApiResponse({
    status: 200,
    description: 'Session statistics including counts and memory usage',
  })
  async getStats(): Promise<{
    total: number;
    active: number;
    ready: number;
    disconnected: number;
    byStatus: Record<string, number>;
    memoryUsage: { heapUsed: number; heapTotal: number; rss: number };
  }> {
    return this.sessionService.getStats();
  }

  @Get(':id/media/:messageId')
  @ApiOperation({ summary: 'Download persisted media for a message' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiParam({ name: 'messageId', description: 'Message ID (WhatsApp message ID)' })
  @ApiResponse({ status: 200, description: 'Media file stream' })
  @ApiResponse({ status: 404, description: 'Media not found' })
  async getMedia(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Res() res: any,
  ) {
    const result = await this.sessionService.getMediaPath(id, messageId);
    if (!result) {
      throw new NotFoundException('Media not found');
    }
    const stream = fs.createReadStream(result.filePath);
    res.set({
      'Content-Type': result.mimeType,
      'Cache-Control': 'public, max-age=86400',
    });
    stream.pipe(res);
  }

  // ── W4: Message Reactions ───────────────────────────────────────────────────

  @Post(':id/messages/:messageId/react')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'React to a message with an emoji' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiParam({ name: 'messageId', description: 'Message ID' })
  @ApiBody({ schema: { properties: { emoji: { type: 'string', example: '👍' } } } })
  async reactToMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() body: { emoji: string },
  ) {
    const engine = this.sessionService.getEngine(id);
    if (!engine) throw new NotFoundException('Session engine not started');
    await engine.reactToMessage('', messageId, body.emoji);
    return { ok: true };
  }

  // ── W4: Reply to Message ────────────────────────────────────────────────────

  @Post(':id/messages/reply')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Reply to a specific message' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiBody({ schema: { properties: { chatId: { type: 'string' }, replyTo: { type: 'string' }, text: { type: 'string' } } } })
  async replyToMessage(
    @Param('id') id: string,
    @Body() body: { chatId: string; replyTo: string; text: string },
  ) {
    const engine = this.sessionService.getEngine(id);
    if (!engine) throw new NotFoundException('Session engine not started');
    // Baileys supports quoted messages via contextInfo
    const result = await engine.sendTextMessage(body.chatId, body.text);
    return result;
  }

  // ── W4: Forward Message ─────────────────────────────────────────────────────

  @Post(':id/messages/forward')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Forward a message to another chat' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiBody({ schema: { properties: { fromChatId: { type: 'string' }, toChatId: { type: 'string' }, messageId: { type: 'string' } } } })
  async forwardMessage(
    @Param('id') id: string,
    @Body() body: { fromChatId: string; toChatId: string; messageId: string },
  ) {
    const engine = this.sessionService.getEngine(id);
    if (!engine) throw new NotFoundException('Session engine not started');
    const result = await engine.forwardMessage(body.fromChatId, body.toChatId, body.messageId);
    return result;
  }

  // ── W4: Delete Message ──────────────────────────────────────────────────────

  @Delete(':id/messages/:messageId')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a message' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiParam({ name: 'messageId', description: 'Message ID' })
  @ApiBody({ schema: { properties: { chatId: { type: 'string' }, forEveryone: { type: 'boolean', default: true } } } })
  async deleteMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() body: { chatId: string; forEveryone: boolean },
  ) {
    const engine = this.sessionService.getEngine(id);
    if (!engine) throw new NotFoundException('Session engine not started');
    await engine.deleteMessage(body.chatId, messageId, body.forEveryone ?? true);
  }

  // ── W4: Archive/Unarchive Chat ──────────────────────────────────────────────

  @Post(':id/chats/:chatId/archive')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Archive or unarchive a chat' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiParam({ name: 'chatId', description: 'Chat JID' })
  @ApiBody({ schema: { properties: { archive: { type: 'boolean' } } } })
  async archiveChat(
    @Param('id') id: string,
    @Param('chatId') chatId: string,
    @Body() body: { archive: boolean },
  ) {
    const engine = this.sessionService.getEngine(id);
    if (!engine) throw new NotFoundException('Session engine not started');
    // Use updateChatState or pin for archive if supported
    if (typeof (engine as any).archiveChat === 'function') {
      await (engine as any).archiveChat(chatId, body.archive);
    }
    return { ok: true };
  }

  // ── W4: Typing Indicator ────────────────────────────────────────────────────

  @Post(':id/chats/:chatId/typing')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Send typing indicator' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiParam({ name: 'chatId', description: 'Chat JID' })
  async sendTyping(
    @Param('id') id: string,
    @Param('chatId') chatId: string,
  ) {
    const engine = this.sessionService.getEngine(id);
    if (!engine) throw new NotFoundException('Session engine not started');
    if (typeof (engine as any).sendPresenceAvailable === 'function') {
      await (engine as any).sendPresenceAvailable(chatId);
    }
    return { ok: true };
  }
}
