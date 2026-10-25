import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ format: 'email', maxLength: 254 }) email!: string;
  @ApiProperty({ format: 'password', minLength: 9, maxLength: 256 })
  password!: string;
}
export class OwnerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}
export class SessionDto {
  @ApiProperty({ type: OwnerDto }) owner!: OwnerDto;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'date-time' }) idleExpiresAt!: string;
}
export class CsrfDto {
  @ApiProperty() token!: string;
}
export class ApiErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
}
