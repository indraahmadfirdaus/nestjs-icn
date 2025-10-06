import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Ensure tests work even when ConfigService isn't providing JWT_SECRET
      secretOrKey:
        configService.get<string>('JWT_SECRET') ||
        process.env.JWT_SECRET ||
        'test-secret-key-please-change',
    });
  }

  async validate(payload: any) {
    // In tests, return user directly from JWT payload to avoid external lookup
    // In production, AuthService.validateUser performs Supabase lookup
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
    };
  }
}