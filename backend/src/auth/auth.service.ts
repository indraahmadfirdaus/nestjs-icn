import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../supabase';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private supabaseService: SupabaseService,
    private jwtService: JwtService,
  ) {}

  private readonly logger = new Logger(AuthService.name);

  async register(registerDto: RegisterDto) {
    const supabase = this.supabaseService.getAdminClient();
    const mode = this.supabaseService.isMock() ? 'mock' : 'real';
    this.logger.log(`Register attempt email=${registerDto.email} mode=${mode}`);

    // Check if user already exists in public.users
    const existing = await supabase
      .from('users')
      .select('*')
      .eq('email', registerDto.email)
      .single();

    if (existing.data) {
      this.logger.warn(`Register conflict: user exists email=${registerDto.email}`);
      throw new ConflictException('User already registered');
    }

    // Hash password using scrypt with salt
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(registerDto.password, salt, 32).toString('hex');
    const encrypted = `${salt}:${hash}`;

    const name = registerDto.name || registerDto.email.split('@')[0];
    const insertUser = {
      email: registerDto.email,
      encrypted_password: encrypted,
      raw_user_meta_data: { name },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any;

    const createRes = await supabase
      .from('users')
      .insert(insertUser)
      .select('*')
      .single();

    if (createRes.error || !createRes.data) {
      const msg = createRes.error?.message || 'Registration failed';
      this.logger.warn(`Register failed email=${registerDto.email} message=${msg}`);
      throw new ConflictException(msg);
    }

    const user = createRes.data;
    this.logger.log(`Register success userId=${user.id} email=${user.email}`);

    // Create JWT token
    const payload = {
      sub: user.id,
      email: user.email,
      name,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name,
      },
      accessToken,
    };
  }

  async login(loginDto: LoginDto) {
    const supabase = this.supabaseService.getAdminClient();
    const mode = this.supabaseService.isMock() ? 'mock' : 'real';
    this.logger.log(`Login attempt email=${loginDto.email} mode=${mode}`);

    const res = await supabase
      .from('users')
      .select('*')
      .eq('email', loginDto.email)
      .single();

    const user = res.data;
    if (res.error || !user) {
      const msg = res.error?.message || 'User not found';
      this.logger.warn(`Login failed email=${loginDto.email} message=${msg}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const [salt, storedHash] = String(user.encrypted_password || '').split(':');
    if (!salt || !storedHash) {
      this.logger.warn(`Login failed email=${loginDto.email} message=Password not set`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const calc = crypto.scryptSync(loginDto.password, salt, 32).toString('hex');
    if (calc !== storedHash) {
      this.logger.warn(`Login failed email=${loginDto.email} message=Wrong password`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const name = user.raw_user_meta_data?.name || user.email?.split('@')[0];
    this.logger.log(`Login success userId=${user.id} email=${user.email}`);

    const payload = {
      sub: user.id,
      email: user.email,
      name,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name,
      },
      accessToken,
    };
  }

  async validateUser(userId: string) {
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new UnauthorizedException('User not found');
    }

    const name = data.raw_user_meta_data?.name || data.email?.split('@')[0];
    return {
      id: data.id,
      email: data.email,
      name,
    };
  }
}