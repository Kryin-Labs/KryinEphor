-- ============================================
-- EduNex Setup Script
-- Run this ONCE in the Supabase SQL Editor
-- ============================================

-- 1. Create system_logs table
CREATE TABLE IF NOT EXISTS public.system_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Logs: Authenticated users can insert"
    ON public.system_logs FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Logs: Superadmins can read all"
    ON public.system_logs FOR SELECT
    USING (public.get_auth_role() = 'superadmin');

CREATE POLICY "Logs: Anon can insert"
    ON public.system_logs FOR INSERT
    TO anon
    WITH CHECK (true);

-- 2. Create the Super Admin profile (run AFTER creating the user in Auth > Users)
-- Replace 'YOUR_SUPER_ADMIN_USER_ID' with the actual UUID from Auth after creating the user
-- INSERT INTO public.profiles (id, email, full_name, role, school_id)
-- VALUES ('YOUR_SUPER_ADMIN_USER_ID', 'admin@edunex.io', 'Super pAdmin', 'superadmin', NULL);
