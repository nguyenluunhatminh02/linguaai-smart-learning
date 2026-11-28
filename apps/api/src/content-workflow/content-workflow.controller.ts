import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Role } from "../users/enums/role.enum";
import { User } from "../users/entities/user.entity";
import { PrismaService } from "../prisma/prisma.service";
import { extractRequestContext } from "../common/utils/request-context.util";
import { ContentWorkflowService } from "./content-workflow.service";
import {
  ListSubmissionsQueryDto,
  RejectSubmissionDto,
  ReviewSubmissionDto,
  SubmitContentDto,
} from "./dto/content-workflow.dto";

@ApiTags("Content Workflow")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MODERATOR)
@Controller("content-workflow")
export class ContentWorkflowController {
  private readonly logger = new Logger(ContentWorkflowController.name);

  constructor(
    private readonly service: ContentWorkflowService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Persist an immutable record of a review decision. Mirrors AdminController's
   * log-and-continue policy: audit failure must never roll back a committed
   * review, but the failure is surfaced for monitoring.
   */
  private async recordReviewAction(
    action: string,
    reviewerId: string,
    submissionId: string,
    req: Request,
    details: string,
  ): Promise<void> {
    const ctx = extractRequestContext(req);
    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: reviewerId,
          action,
          resource: "content_workflow",
          resource_type: "content_submission",
          resource_id: submissionId,
          details,
          ip_address: ctx.ip,
          user_agent: ctx.ua,
          device_id: ctx.device,
          success: true,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to record content review audit log (${action}): ${(err as Error).message}`,
      );
    }
  }

  @Get("submissions")
  @ApiOperation({ summary: "List content submissions awaiting review" })
  @ApiQuery({ name: "status", required: false, enum: ["PENDING", "APPROVED", "REJECTED"] })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  list(@Query() query: ListSubmissionsQueryDto) {
    return this.service.list(query.status, query.limit, query.offset);
  }

  @Get("submissions/:id")
  @ApiOperation({ summary: "Get one submission" })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.getById(id);
  }

  @Post("submissions")
  @ApiOperation({ summary: "Submit a content item for review" })
  submit(@Body() body: SubmitContentDto, @CurrentUser() author: User) {
    return this.service.submit(body.contentItemId, author.id);
  }

  @Patch("submissions/:id/approve")
  @ApiOperation({ summary: "Approve and publish a submission" })
  async approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ReviewSubmissionDto,
    @CurrentUser() reviewer: User,
    @Req() req: Request,
  ) {
    const result = await this.service.approve(
      id,
      reviewer.id,
      body.reviewNotes,
      body.version,
    );
    await this.recordReviewAction(
      "CONTENT_APPROVED",
      reviewer.id,
      id,
      req,
      `version=${result?.version ?? "unknown"}`,
    );
    return result;
  }

  @Patch("submissions/:id/reject")
  @ApiOperation({ summary: "Reject a submission" })
  async reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RejectSubmissionDto,
    @CurrentUser() reviewer: User,
    @Req() req: Request,
  ) {
    const result = await this.service.reject(
      id,
      reviewer.id,
      body.reviewNotes,
      body.version,
    );
    await this.recordReviewAction(
      "CONTENT_REJECTED",
      reviewer.id,
      id,
      req,
      `version=${result?.version ?? "unknown"}`,
    );
    return result;
  }
}
