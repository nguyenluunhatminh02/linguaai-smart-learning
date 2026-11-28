import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_MIME_TYPES,
  VALIDATION_ERROR_MESSAGE,
  normalizeMimeType,
  uploadSizeLimitForMimeType,
} from './file-validation';

@ApiTags('Files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  // SEC-07/SEC-08: reject oversized or disallowed payloads in the parser,
  // before Multer buffers them, rather than after the file reaches the service.
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8 },
      fileFilter: (_req, file, callback) => {
        if (!UPLOAD_MIME_TYPES.includes(normalizeMimeType(file.mimetype))) {
          callback(new BadRequestException(VALIDATION_ERROR_MESSAGE), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file (image or audio) to the server' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadFile(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    // Defence in depth: the service re-validates the signature and derives the
    // object name and extension server-side from the validated MIME type.
    if (file.size > uploadSizeLimitForMimeType(file.mimetype)) {
      throw new BadRequestException(
        `File size exceeds limit (${MAX_UPLOAD_BYTES / 1024 / 1024}MB).`,
      );
    }

    const url = await this.filesService.uploadFile(file, userId);
    return { url };
  }

  @Post('tts')
  @ApiOperation({ summary: 'Generate public TTS pronunciation URL' })
  async generateTTS(@Body() body: { text: string; language: string }) {
    const url = await this.filesService.generateTTS(body.text, body.language);
    return { url };
  }
}
