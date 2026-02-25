import { v2 as cloudinary } from 'cloudinary';

// Pass the config from NestJS instead of reading process.env directly
export function initCloudinary(config: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}) {
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
  });
  return cloudinary;
}
