import { SetMetadata } from '@nestjs/common';

export const SKIP_CITY_REQUIRED_KEY = 'skipCityRequired';
export const SkipCityRequired = () => SetMetadata(SKIP_CITY_REQUIRED_KEY, true);
