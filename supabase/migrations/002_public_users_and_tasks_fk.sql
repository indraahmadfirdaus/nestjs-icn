-- Create public.users and rewire tasks FK to public.users

-- Ensure UUID extension exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create public.users table
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  encrypted_password TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Copy existing users from auth.users (if any)
INSERT INTO public.users (id, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
SELECT id, email, encrypted_password, raw_user_meta_data, created_at, updated_at
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Drop existing FK on tasks.user_id if it points to auth.users
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'tasks'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.constraint_name = 'tasks_user_id_fkey'
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_user_id_fkey;
  END IF;
END$$;

-- Add new FK pointing to public.users(id)
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Indexes and grants
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
GRANT ALL ON TABLE public.users TO anon, authenticated, service_role;

-- RLS optional: enable for privacy (service_role bypasses RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- Example policy: users can select their own profile (optional)
DROP POLICY IF EXISTS "Users can view themselves" ON public.users;
CREATE POLICY "Users can view themselves"
  ON public.users FOR SELECT
  USING (id = auth.uid());