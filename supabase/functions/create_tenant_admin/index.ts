import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const getCorsHeaders = (req: Request) => {
    const origin = req.headers.get('Origin') ?? '';
    const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('ALLOWED_ORIGIN') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const allowedOrigins = new Set(['https://kryinedu.lovable.app', ...configured]);
    const allowOrigin = allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.(lovable\.app|lovableproject\.com|sandbox\.lovable\.dev)$/i.test(origin)
        ? origin
        : 'https://kryinedu.lovable.app';
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
};

// Whitelist of valid roles that can be created
const VALID_ROLES = ['admin', 'teacher', 'student', 'parent', 'accountant', 'receptionist'] as const;
type ValidRole = typeof VALID_ROLES[number];

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders(req);

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');

        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 401,
            });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
            return new Response(JSON.stringify({ error: 'Server misconfiguration: missing environment variables' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            });
        }

        // Verify JWT manually
        const callerClient = createClient(
            supabaseUrl,
            supabaseAnonKey,
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();

        if (callerError || !caller) {
            return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 401,
            });
        }

        // Create admin client with service role
        const supabaseAdmin = createClient(
            supabaseUrl,
            serviceRoleKey,
            { auth: { autoRefreshToken: false, persistSession: false } }
        );

        // Fetch caller profile to check role, active status, and school context
        const { data: callerProfile } = await supabaseAdmin
            .from('profiles')
            .select('role, school_id, is_active, deleted_at')
            .eq('id', caller.id)
            .single();

        if (!callerProfile) {
            return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 403,
            });
        }

        if (callerProfile.is_active === false || callerProfile.deleted_at) {
            return new Response(JSON.stringify({ error: 'Forbidden: caller account is inactive or deleted' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 403,
            });
        }

        // Load additional capability roles from user_roles (supporting capability-based access)
        const { data: callerUserRoles } = await supabaseAdmin
            .from('user_roles')
            .select('role')
            .eq('user_id', caller.id);

        const callerRoleSet = new Set<string>();
        if (callerProfile.role) callerRoleSet.add(callerProfile.role);
        (callerUserRoles || []).forEach((r: { role: string }) => {
            if (r.role) callerRoleSet.add(r.role);
        });

        const isSuperAdmin = callerRoleSet.has('superadmin');
        const isAdmin = callerRoleSet.has('admin');

        if (!isSuperAdmin && !isAdmin) {
            return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 403,
            });
        }

        // Parse and validate JSON body
        let payload;
        try {
            payload = await req.json();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid or malformed JSON payload' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        const { password, fullName, schoolId, role, classId } = payload;
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : payload.email;

        if (!email || !password || !fullName) {
            return new Response(JSON.stringify({ error: 'Missing required fields: email, password, fullName' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // ROLE VALIDATION — BEFORE any mutation (Item 10)
        // Explicitly reject invalid roles with HTTP 400. Never default 'foobar' -> 'admin'.
        // ═══════════════════════════════════════════════════════════════
        if (role !== undefined && role !== null && role !== '') {
            if (!VALID_ROLES.includes(role)) {
                return new Response(JSON.stringify({ error: `Invalid role: '${role}'. Allowed: ${VALID_ROLES.join(', ')}` }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }
        }
        const targetRole: ValidRole = role || 'admin';

        if (targetRole !== 'admin' && !schoolId) {
            return new Response(JSON.stringify({ error: `${targetRole} users must be assigned to a school` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        if (targetRole === 'admin' && !schoolId) {
            return new Response(JSON.stringify({ error: 'School admins must be assigned to a school. Only superadmins can be platform-level users.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        if (!isSuperAdmin) {
            // School admins cannot create superadmins
            if (role === 'superadmin') {
                return new Response(JSON.stringify({ error: 'Forbidden: Admin cannot create superadmin users' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            // School admins must have a school context
            if (!callerProfile.school_id) {
                return new Response(JSON.stringify({ error: 'Forbidden: Admin has no school context' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            // School admins can only create users in their own school
            if (schoolId !== callerProfile.school_id) {
                return new Response(JSON.stringify({ error: 'Forbidden: Admin cannot create users for other schools' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
        }

        // Validate schoolId exists and is active in the database before creating the user
        let combinedStudentParentAccount = false;
        if (schoolId) {
            const { data: school } = await supabaseAdmin
                .from('schools')
                .select('id, status, deleted_at, email_domain, combined_parent_student_account')
                .eq('id', schoolId)
                .is('deleted_at', null)
                .single();
            if (!school || (school.status && school.status.toLowerCase() !== 'active')) {
                return new Response(JSON.stringify({ error: 'Invalid schoolId: school does not exist or is not active' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }
            combinedStudentParentAccount = targetRole === 'student' && school.combined_parent_student_account !== false;
            // Enforce school email-domain policy for ALL roles in the tenant.
            if (school.email_domain) {
                const expectedSuffix = '@' + String(school.email_domain).toLowerCase();
                if (!email.endsWith(expectedSuffix)) {
                    return new Response(JSON.stringify({
                        error: `Email must end with ${expectedSuffix} for this school.`,
                    }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                        status: 400,
                    });
                }
            } else {
                return new Response(JSON.stringify({
                    error: 'This school has no email domain configured. Ask a superadmin to set the school email domain before creating users.',
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400,
                });
            }

            if (classId !== undefined) {
                if (targetRole !== 'student' || typeof classId !== 'string') {
                    return new Response(JSON.stringify({ error: 'Only student accounts can be assigned to a class.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
                const { data: assignedClass } = await supabaseAdmin
                    .from('classes').select('id').eq('id', classId).eq('school_id', schoolId).is('deleted_at', null).maybeSingle();
                if (!assignedClass) {
                    return new Response(JSON.stringify({ error: 'Selected class was not found in this school.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
            }

            // Upfront validation for guardian linking BEFORE creating Auth user
            if (payload.guardianId) {
                if (targetRole !== 'student') {
                    return new Response(JSON.stringify({ error: 'Only student accounts can be linked to a guardian.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
                const allowedRelationships = [
                    'mother', 'father', 'guardian', 'legal guardian', 'parent',
                    'son', 'daughter', 'child', 'ward', 'other authorized guardian',
                    'primary guardian', 'emergency contact'
                ];
                const relToCheck = (payload.guardianRelationship || 'parent').trim().toLowerCase();
                if (relToCheck === 'self_student' || !allowedRelationships.includes(relToCheck)) {
                    return new Response(JSON.stringify({ 
                        error: `Invalid guardian relationship: "${payload.guardianRelationship}". Must be one of: Mother, Father, Guardian, Legal Guardian, Parent, Son, Daughter, Child, Ward, Other authorized guardian, Primary guardian, Emergency contact.` 
                    }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
                const { data: guardian, error: guardianErr } = await supabaseAdmin
                    .from('profiles')
                    .select('id, school_id, full_name, role, is_active, deleted_at')
                    .eq('id', payload.guardianId)
                    .maybeSingle();

                if (guardianErr || !guardian) {
                    return new Response(JSON.stringify({ error: 'Selected guardian account was not found.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
                if (guardian.school_id !== schoolId) {
                    return new Response(JSON.stringify({ error: 'Selected guardian does not belong to this school.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
                if (guardian.deleted_at) {
                    return new Response(JSON.stringify({ error: 'Selected guardian account is deleted.' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
                    });
                }
            }
        }



        // ═══════════════════════════════════════════════════════════════
        // CREATE AUTH USER — Pass correct metadata (Fixes Problem #6, #37)
        // The handle_new_user() trigger reads these fields to create
        // the correct profile on first INSERT, eliminating the race
        // condition where a wrong-role profile is created.
        // ═══════════════════════════════════════════════════════════════
        const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            app_metadata: {
                role: targetRole,
                school_id: schoolId || null
            },
            user_metadata: {
                full_name: fullName,
                role: targetRole,
                school_id: schoolId || null,
            }
        });

        if (userError) {
            return new Response(JSON.stringify({ error: `Auth user creation failed: ${userError.message}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        const rollbackUser = async (userId: string) => {
            try {
                const resClass = await supabaseAdmin.from('class_enrollments').delete().eq('student_id', userId);
                if (resClass.error) console.error(`Rollback error class_enrollments for user ${userId}:`, resClass.error);

                const resParent = await supabaseAdmin.from('parent_student').delete().eq('student_id', userId);
                if (resParent.error) console.error(`Rollback error parent_student for user ${userId}:`, resParent.error);

                const resEmp = await supabaseAdmin.from('employees').delete().eq('profile_id', userId);
                if (resEmp.error) console.error(`Rollback error employees for user ${userId}:`, resEmp.error);

                const resMem = await supabaseAdmin.from('memberships').delete().eq('user_id', userId);
                if (resMem.error) console.error(`Rollback error memberships for user ${userId}:`, resMem.error);

                const resRoles = await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
                if (resRoles.error) console.error(`Rollback error user_roles for user ${userId}:`, resRoles.error);

                const resProf = await supabaseAdmin.from('profiles').delete().eq('id', userId);
                if (resProf.error) console.error(`Rollback error profiles for user ${userId}:`, resProf.error);

                const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
                if (authError) {
                    console.error(`Rollback failed to delete auth user ${userId}:`, authError);
                }
            } catch (rbErr) {
                console.error(`Rollback exception for user ${userId}:`, rbErr);
            }
        };

        // ═══════════════════════════════════════════════════════════════
        // TRANSACTIONAL DOMAIN SETUP VIA RPC (Phase 21 hardening)
        // Everything inside fn_setup_tenant_user_domain runs atomically.
        // If anything fails (e.g. invalid class, invalid guardian, etc.),
        // the DB transaction automatically rolls back.
        // ═══════════════════════════════════════════════════════════════
        const { error: domainError } = await supabaseAdmin.rpc('fn_setup_tenant_user_domain', {
            _user_id: userData.user.id,
            _email: email,
            _full_name: fullName,
            _role: targetRole,
            _school_id: schoolId || null,
            _caller_id: caller.id,
            _class_id: classId || null,
            _guardian_id: payload.guardianId || null,
            _guardian_relationship: payload.guardianRelationship || 'Parent',
            _is_primary_guardian: payload.isPrimaryGuardian !== undefined ? payload.isPrimaryGuardian : null,
            _combined_account: !!combinedStudentParentAccount,
            _employee_designation: typeof payload.designation === 'string' && payload.designation.trim() ? payload.designation.trim() : null,
            _employee_department: typeof payload.department === 'string' && payload.department.trim() ? payload.department.trim() : null,
            _employee_name: typeof payload.staffPersonName === 'string' && payload.staffPersonName.trim() ? payload.staffPersonName.trim() : null,
        });

        if (domainError) {
            await rollbackUser(userData.user.id);
            return new Response(JSON.stringify({ error: `Domain setup failed: ${domainError.message}. User rolled back.` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }


        return new Response(JSON.stringify({ success: true, user: { id: userData.user.id, email } }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        return new Response(JSON.stringify({ error: message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});
