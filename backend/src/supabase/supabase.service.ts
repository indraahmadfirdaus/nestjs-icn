import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;
  private supabaseAdmin: SupabaseClient;
  private useMock = false;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL') || process.env.SUPABASE_URL;
    const supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const useMockEnv = this.configService.get<string>('SUPABASE_USE_MOCK') || process.env.SUPABASE_USE_MOCK;
    const nodeEnv = this.configService.get<string>('NODE_ENV') || process.env.NODE_ENV;

    // Decide whether to use mock based on explicit env, missing config, or development mode
    const shouldDefaultMock = nodeEnv === 'development' || nodeEnv === 'test';
    this.useMock = (useMockEnv === 'true') || (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) || shouldDefaultMock;

    // If not using mock, use real Supabase clients; otherwise fall back to in-memory mock
    if (!this.useMock) {
      // Client for regular operations
      this.supabase = createClient(supabaseUrl, supabaseAnonKey);
      // Admin client for privileged operations
      this.supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    } else {
      this.useMock = true;
      // eslint-disable-next-line no-console
      console.warn('[SupabaseService] Env not fully configured. Using in-memory mock client.');
      const mockClient: any = this.createSupabaseClientMock();
      this.supabase = mockClient as SupabaseClient;
      this.supabaseAdmin = mockClient as SupabaseClient;
    }
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  getAdminClient(): SupabaseClient {
    return this.supabaseAdmin;
  }

  isMock(): boolean {
    return this.useMock;
  }

  // Lightweight in-memory Supabase mock implementing required API surface
  private createSupabaseClientMock() {
    let userCounter = 1;
    let taskCounter = 1;
    const usersByEmail = new Map<string, any>();
    const usersById = new Map<string, any>();
    const tasks: any[] = [];
    const publicUsers: any[] = [];
    const isUsersTable = (tableName: string) => tableName === 'public.users' || tableName === 'users';

    const auth = {
      async signUp({ email, password, options }: any) {
        if (usersByEmail.has(email)) {
          return { data: { user: null }, error: { message: 'User already registered' } };
        }
        const id = `user-${userCounter++}`;
        const user = {
          id,
          email,
          user_metadata: { name: options?.data?.name },
        };
        const record = { ...user, password };
        usersByEmail.set(email, record);
        usersById.set(id, record);
        return { data: { user }, error: null };
      },
      async signInWithPassword({ email, password }: any) {
        const record = usersByEmail.get(email);
        if (!record || record.password !== password) {
          return { data: { user: null }, error: { message: 'Invalid credentials' } };
        }
        const { id, user_metadata } = record;
        return { data: { user: { id, email, user_metadata } }, error: null };
      },
      admin: {
        async getUserById(userId: string) {
          const record = usersById.get(userId);
          if (!record) {
            return { data: { user: null }, error: { message: 'User not found' } };
          }
          const { email, id, user_metadata } = record;
          return { data: { user: { id, email, user_metadata } }, error: null };
        },
      },
    };

    class Query {
      private table: string;
      private filters: Record<string, any> = {};
      private lastResult: any = null;
      private pendingUpdate: any = null;
      private deleteMode = false;

      constructor(table: string) {
        this.table = table;
      }

      from(table: string) {
        this.table = table;
        return this;
      }

      insert(data: any) {
        if (this.table === 'tasks') {
          const id = `task-${taskCounter++}`;
          const now = new Date().toISOString();
          const row = { id, created_at: now, updated_at: now, ...data };
          tasks.push(row);
          this.lastResult = row;
        } else if (this.table === 'email_logs') {
          this.lastResult = { id: `email-${Date.now()}`, ...data };
        } else if (isUsersTable(this.table)) {
          const id = `user-${userCounter++}`;
          const now = new Date().toISOString();
          const row = {
            id,
            created_at: now,
            updated_at: now,
            raw_user_meta_data: {},
            ...data,
          };
          publicUsers.push(row);
          this.lastResult = row;
        }
        return this;
      }

      select(_columns?: string) {
        return this;
      }

      eq(column: string, value: any) {
        this.filters[column] = value;
        if (this.deleteMode && this.table === 'tasks') {
          const hasId = Object.prototype.hasOwnProperty.call(this.filters, 'id');
          const hasUser = Object.prototype.hasOwnProperty.call(this.filters, 'user_id');
          if (hasId && hasUser) {
            for (let i = tasks.length - 1; i >= 0; i--) {
              const t = tasks[i];
              let match = true;
              for (const [k, v] of Object.entries(this.filters)) {
                if (t[k] !== v) {
                  match = false;
                  break;
                }
              }
              if (match) {
                tasks.splice(i, 1);
              }
            }
            this.deleteMode = false;
            return this;
          }
        }
        return this;
      }

      order(column: string, opts: { ascending: boolean }) {
        if (this.table === 'tasks') {
          let rows = tasks.filter((t) => {
            for (const [k, v] of Object.entries(this.filters)) {
              if (t[k] !== v) return false;
            }
            return true;
          });
          rows = rows.sort((a, b) => {
            const av = new Date(a[column]).getTime();
            const bv = new Date(b[column]).getTime();
            return opts?.ascending ? av - bv : bv - av;
          });
          return Promise.resolve({ data: rows, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }

      async single() {
        if (this.table === 'tasks' && this.pendingUpdate) {
          const rows = tasks.filter((t) => {
            for (const [k, v] of Object.entries(this.filters)) {
              if (t[k] !== v) return false;
            }
            return true;
          });
          const first = rows[0];
          if (first) {
            Object.assign(first, this.pendingUpdate, {
              updated_at: new Date().toISOString(),
            });
            this.lastResult = first;
          }
          this.pendingUpdate = null;
        }
        if (Object.keys(this.filters).length === 0 && this.lastResult) {
          return { data: this.lastResult, error: null };
        }
        if (this.table === 'tasks') {
          const rows = tasks.filter((t) => {
            for (const [k, v] of Object.entries(this.filters)) {
              if (t[k] !== v) return false;
            }
            return true;
          });
          const first = rows[0];
          return first ? { data: first, error: null } : { data: null, error: { message: 'Not found' } };
        } else if (isUsersTable(this.table)) {
          const rows = publicUsers.filter((u) => {
            for (const [k, v] of Object.entries(this.filters)) {
              if (u[k] !== v) return false;
            }
            return true;
          });
          const first = rows[0];
          return first ? { data: first, error: null } : { data: null, error: { message: 'Not found' } };
        }
        return { data: null, error: null };
      }

      update(updateData: any) {
        if (this.table === 'tasks') {
          this.pendingUpdate = updateData;
        }
        return this;
      }

      delete() {
        this.deleteMode = true;
        return this;
      }
    }

    function from(table: string) {
      const q = new Query(table);
      return new Proxy(q, {
        get(target, prop, receiver) {
          if (prop === 'select') return target.select.bind(target);
          if (prop === 'insert') return target.insert.bind(target);
          if (prop === 'single') return target.single.bind(target);
          if (prop === 'eq') return target.eq.bind(target);
          if (prop === 'order') return target.order.bind(target);
          if (prop === 'update') return async (ud: any) => {
            await target.update(ud);
            return receiver;
          };
          if (prop === 'delete') return async () => {
            await target.delete();
            return receiver;
          };
          return Reflect.get(target, prop, receiver);
        },
      });
    }

    return {
      auth,
      from,
    };
  }
}