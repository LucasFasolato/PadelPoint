import { SetMetadata, applyDecorators } from '@nestjs/common';

const SWAGGER_TAGS_KEY = 'swagger/apiUseTags';

export function ApiTags(...tags: string[]) {
  return applyDecorators(SetMetadata(SWAGGER_TAGS_KEY, tags));
}
