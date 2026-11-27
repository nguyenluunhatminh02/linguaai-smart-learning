import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Req,
  Logger,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Role } from "../users/enums/role.enum";
import {
  CreateContentDto,
  UpdateContentDto,
  UpdateUserRoleDto,
  GrantTokensDto,
} from "./dto/admin.dto";
import { TokensService } from "../tokens/tokens.service";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { User } from "../users/entities/user.entity";
import { Request } from "express";
import { extractRequestContext } from "../common/utils/request-context.util";

@ApiTags("Admin")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller("admin")
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private adminService: AdminService,
    private tokensService: TokensService,
    private prisma: PrismaService,
  ) {}

  /**
   * Persist an immutable record of a privileged action. The acting admin's id,
   * the target, and the request context are recorded so destructive operations
   * can be attributed during incident investigation.
   */
  private async recordAdminAction(
    action: string,
    adminId: string,
    targetUserId: string,
    req: Request,
    details: string,
  ): Promise<void> {
    const ctx = extractRequestContext(req);
    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: adminId,
          action,
          resource: "admin_users",
          resource_type: "user",
          resource_id: targetUserId,
          details,
          ip_address: ctx.ip,
          user_agent: ctx.ua,
          success: true,
        },
      });
    } catch (err) {
      // Never block a privileged action on audit logging, but surface the
      // failure loudly so monitoring can alert on a missing audit trail.
      this.logger.error(`Failed to record admin audit log (${action}): ${err.message}`);
    }
  }

  @Post("users/:id/tokens")
  @ApiOperation({ summary: "Grant tokens to a user" })
  async grantTokens(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: GrantTokensDto,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const result = await this.tokensService.addTokens(
      id,
      body.amount,
      "admin_grant",
      body.reason,
    );
    await this.recordAdminAction(
      "ADMIN_TOKEN_GRANT",
      admin.id,
      id,
      req,
      `amount=${body.amount}; reason=${body.reason || '(none)'}`,
    );
    return result;
  }

  @Get("users/:id/tokens/history")
  @ApiOperation({ summary: "Get token transaction history for a user (admin)" })
  async getUserTokenHistory(@Param("id", ParseUUIDPipe) id: string) {
    return this.tokensService.getHistory(id);
  }

  @Get("overview")
  @ApiOperation({ summary: "Get admin dashboard overview" })
  getOverview() {
    return this.adminService.getOverview();
  }

  @Get("users")
  @ApiOperation({ summary: "Get all users (admin)" })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "limit", required: false })
  async getUsers(@Query("page") page?: number, @Query("limit") limit?: number) {
    return this.adminService.getAllUsers(page || 1, limit || 20);
  }

  @Patch("users/:id/role")
  @ApiOperation({ summary: "Update user role" })
  async updateRole(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateUserRoleDto,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const result = await this.adminService.updateUserRole(id, body.role);
    await this.recordAdminAction(
      "ADMIN_ROLE_CHANGE",
      admin.id,
      id,
      req,
      `role=${body.role}`,
    );
    return result;
  }

  @Delete("users/:id")
  @ApiOperation({ summary: "Delete a user" })
  async deleteUser(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
    @Req() req: Request,
  ) {
    const result = await this.adminService.deleteUser(id);
    await this.recordAdminAction(
      "ADMIN_USER_DELETE",
      admin.id,
      id,
      req,
      "user deleted by admin",
    );
    return result;
  }

  // ===== Content Management =====

  @Get("content")
  @ApiOperation({ summary: "Get all content items" })
  @ApiQuery({ name: "type", required: false })
  getContent(@Query("type") type?: string) {
    return this.adminService.getContent(type);
  }

  @Post("content")
  @ApiOperation({ summary: "Create a content item" })
  createContent(@Body() body: CreateContentDto) {
    return this.adminService.createContent(body);
  }

  @Patch("content/:id")
  @ApiOperation({ summary: "Update a content item" })
  updateContent(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateContentDto,
  ) {
    return this.adminService.updateContent(id, body);
  }

  @Delete("content/:id")
  @ApiOperation({ summary: "Delete a content item" })
  deleteContent(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.deleteContent(id);
  }
}
