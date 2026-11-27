import { Controller, Get, Param, Query, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

@ApiTags("Lessons")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("lessons")
export class LessonsController {
  constructor(private adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: "Get all lessons (public/student)" })
  @ApiQuery({ name: "type", required: false })
  async getLessons(@Query("type") type?: string) {
    const items = await this.adminService.getContent(type);
    return { data: items };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get lesson by ID (public/student)" })
  async getLesson(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.getContentById(id);
  }
}
