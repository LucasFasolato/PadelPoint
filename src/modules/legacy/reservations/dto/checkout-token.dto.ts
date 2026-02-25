import { IsString, Length } from 'class-validator';

export class CheckoutTokenDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}
