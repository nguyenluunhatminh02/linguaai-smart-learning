import { Controller, Post, UseInterceptors, UploadedFile, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
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
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    
    // Validate file type & size (10MB for images, 50MB for audio)
    const allowedImageMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const allowedAudioMimeTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'audio/webm',
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
      'audio/aac',
      'audio/flac',
      'audio/x-flac',
    ];
    const allowedMimeTypes = [...allowedImageMimeTypes, ...allowedAudioMimeTypes];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only standard images and audio are allowed.');
    }

    const isImage = allowedImageMimeTypes.includes(file.mimetype);
    const maxSize = isImage ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(`File size exceeds limit (${isImage ? '10MB' : '50MB'}).`);
    }

    const url = await this.filesService.uploadFile(file);
    return { url };
  }

  @Post('tts')
  @ApiOperation({ summary: 'Generate public TTS pronunciation URL' })
  async generateTTS(@Body() body: { text: string; language: string }) {
    const url = await this.filesService.generateTTS(body.text, body.language);
    return { url };
  }
}
