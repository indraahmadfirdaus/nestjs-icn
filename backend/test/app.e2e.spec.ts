import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../src/supabase';
import { EmailService } from '../src/email/email.service';
import { AiService } from '../src/ai/ai.service';

// Ensure JWT secret exists during tests
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-please-change';

// Simple in-memory Supabase client mock
function createSupabaseClientMock() {
  let userCounter = 1;
  let taskCounter = 1;
  const usersByEmail = new Map<string, any>();
  const usersById = new Map<string, any>();
  const tasks: any[] = [];

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
  };

  const admin = {
    async getUserById(userId: string) {
      const record = usersById.get(userId);
      if (!record) {
        return { data: { user: null }, error: { message: 'User not found' } };
      }
      const { email, id, user_metadata } = record;
      return { data: { user: { id, email, user_metadata } }, error: null };
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
        // store email logs as no-op
        this.lastResult = { id: `email-${Date.now()}`, ...data };
      }
      return this;
    }

    select(_columns?: string) {
      return this;
    }

    eq(column: string, value: any) {
      this.filters[column] = value;
      // If in delete mode and we have enough filters, perform deletion now
      if (this.deleteMode && this.table === 'tasks') {
        const hasId = Object.prototype.hasOwnProperty.call(this.filters, 'id');
        const hasUser = Object.prototype.hasOwnProperty.call(
          this.filters,
          'user_id',
        );
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
          // keep returning this to allow method chaining
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
      // Apply pending update if present
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
      // If no filters specified, return the last inserted/selected row
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
    async selectAndSingle() {
      return this.single();
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
        if (prop === 'update') return (ud: any) => {
          target.update(ud);
          return receiver;
        };
        if (prop === 'delete') return () => {
          // set delete mode and allow chaining filters with eq(...)
          target.delete();
          return receiver;
        };
        if (prop === 'selectAndSingle') return target.selectAndSingle.bind(target);
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value) {
        // Simply set properties; updates are applied during single() based on filters
        (target as any)[prop as any] = value;
        return true;
      },
    });
  }

  return {
    auth,
    admin,
    from,
  };
}

class SupabaseServiceMock {
  private client = createSupabaseClientMock();
  getClient() { return this.client; }
  getAdminClient() { return this.client; }
}

class EmailServiceMock {
  async sendTaskCreatedNotification() {
    return;
  }
  async sendDailySummary() {
    return;
  }
}

class AiServiceMock {
  async generateTaskSuggestions(context?: string) {
    return {
      suggestions: [
        { title: 'Mock Task 1', description: `Context: ${context || 'none'}` },
        { title: 'Mock Task 2', description: 'Keep productivity high' },
      ],
    };
  }
}

describe('Task Board API (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let userId: string;
  let taskId: string;
  const testEmail = `test${Date.now()}@example.com`;
  const testPassword = 'testpass123';

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) => (key === 'JWT_SECRET' ? 'test-secret-key-please-change' : undefined),
      })
      .overrideProvider(SupabaseService)
      .useValue(new SupabaseServiceMock())
      .overrideProvider(EmailService)
      .useValue(new EmailServiceMock())
      .overrideProvider(AiService)
      .useValue(new AiServiceMock());

    const moduleFixture: TestingModule = await moduleBuilder.compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Authentication', () => {
    it('/auth/register (POST) - should register a new user', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          name: 'Test User',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('accessToken');
          expect(res.body).toHaveProperty('user');
          expect(res.body.user.email).toBe(testEmail);
          authToken = res.body.accessToken;
          userId = res.body.user.id;
        });
    });

    it('/auth/register (POST) - should fail with invalid email', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: testPassword,
        })
        .expect(400);
    });

    it('/auth/register (POST) - should fail with short password', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test2@example.com',
          password: '123',
        })
        .expect(400);
    });

    it('/auth/login (POST) - should login successfully', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('accessToken');
          expect(res.body.user.email).toBe(testEmail);
        });
    });

    it('/auth/login (POST) - should fail with wrong password', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'wrongpassword',
        })
        .expect(401);
    });

    it('/auth/login (POST) - should fail with non-existent email', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'notexist@example.com',
          password: testPassword,
        })
        .expect(401);
    });

    it('/auth/me (GET) - should get current user profile', () => {
      return request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.email).toBe(testEmail);
          expect(res.body.id).toBe(userId);
        });
    });

    it('/auth/me (GET) - should fail without token', () => {
      return request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);
    });

    it('/auth/me (GET) - should fail with invalid token', () => {
      return request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('Tasks', () => {
    it('/tasks (POST) - should create a new task', () => {
      return request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Test Task',
          description: 'This is a test task',
          status: 'todo',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.title).toBe('Test Task');
          expect(res.body.status).toBe('todo');
          taskId = res.body.id;
        });
    });

    it('/tasks (POST) - should fail without auth', () => {
      return request(app.getHttpServer())
        .post('/tasks')
        .send({
          title: 'Test Task',
        })
        .expect(401);
    });

    it('/tasks (POST) - should fail without title', () => {
      return request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          description: 'No title',
        })
        .expect(400);
    });

    it('/tasks (POST) - should fail with invalid status', () => {
      return request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Test',
          status: 'invalid_status',
        })
        .expect(400);
    });

    it('/tasks (GET) - should get all user tasks', () => {
      return request(app.getHttpServer())
        .get('/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBeGreaterThan(0);
          expect(res.body[0]).toHaveProperty('id');
          expect(res.body[0]).toHaveProperty('title');
        });
    });

    it('/tasks (GET) - should fail without auth', () => {
      return request(app.getHttpServer())
        .get('/tasks')
        .expect(401);
    });

    it('/tasks/:id (GET) - should get specific task', () => {
      return request(app.getHttpServer())
        .get(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(taskId);
          expect(res.body.title).toBe('Test Task');
        });
    });

    it('/tasks/:id (GET) - should fail with invalid id', () => {
      return request(app.getHttpServer())
        .get('/tasks/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('/tasks/:id (PATCH) - should update task', () => {
      return request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: 'in_progress',
          description: 'Updated description',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('in_progress');
          expect(res.body.description).toBe('Updated description');
        });
    });

    it('/tasks/:id (PATCH) - should fail without auth', () => {
      return request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .send({
          status: 'done',
        })
        .expect(401);
    });

    it('/tasks/:id (PATCH) - should fail with invalid status', () => {
      return request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: 'invalid',
        })
        .expect(400);
    });

    it('/tasks/:id (DELETE) - should delete task', () => {
      return request(app.getHttpServer())
        .delete(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.message).toContain('deleted successfully');
        });
    });

    it('/tasks/:id (DELETE) - should fail without auth', () => {
      return request(app.getHttpServer())
        .delete(`/tasks/${taskId}`)
        .expect(401);
    });

    it('/tasks/:id (GET) - should return 404 for deleted task', () => {
      return request(app.getHttpServer())
        .get(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('AI Suggestions', () => {
    it('/ai/suggestions (POST) - should generate task suggestions', () => {
      return request(app.getHttpServer())
        .post('/ai/suggestions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          context: 'software development tasks',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('suggestions');
          expect(Array.isArray(res.body.suggestions)).toBe(true);
          expect(res.body.suggestions.length).toBeGreaterThan(0);
          expect(res.body.suggestions[0]).toHaveProperty('title');
          expect(res.body.suggestions[0]).toHaveProperty('description');
        });
    });

    it('/ai/suggestions (POST) - should work without context', () => {
      return request(app.getHttpServer())
        .post('/ai/suggestions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('suggestions');
          expect(Array.isArray(res.body.suggestions)).toBe(true);
        });
    });

    it('/ai/suggestions (POST) - should fail without auth', () => {
      return request(app.getHttpServer())
        .post('/ai/suggestions')
        .send({})
        .expect(401);
    });
  });

  describe('Complete Workflow', () => {
    it('should complete full task lifecycle', async () => {
      // 1. Create task
      const createRes = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Workflow Test Task',
          description: 'Testing complete workflow',
          status: 'todo',
          dueDate: new Date(Date.now() + 86400000).toISOString(),
        })
        .expect(201);

      const newTaskId = createRes.body.id;

      // 2. Get all tasks and verify new task exists
      const getAllRes = await request(app.getHttpServer())
        .get('/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(getAllRes.body.some((t) => t.id === newTaskId)).toBe(true);

      // 3. Update task to in_progress
      await request(app.getHttpServer())
        .patch(`/tasks/${newTaskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'in_progress' })
        .expect(200);

      // 4. Update task to done
      await request(app.getHttpServer())
        .patch(`/tasks/${newTaskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'done' })
        .expect(200);

      // 5. Get specific task and verify status
      const getOneRes = await request(app.getHttpServer())
        .get(`/tasks/${newTaskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(getOneRes.body.status).toBe('done');

      // 6. Delete task
      await request(app.getHttpServer())
        .delete(`/tasks/${newTaskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // 7. Verify task is deleted
      await request(app.getHttpServer())
        .get(`/tasks/${newTaskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });
});