export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          id: string
          school_id: string | null
          created_by: string | null
          title: string
          body: string
          accent: string
          audience: string
          role_targets: string[]
          class_targets: string[]
          user_targets: string[]
          status: string
          published_at: string | null
          expires_at: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          school_id?: string | null
          created_by?: string | null
          title: string
          body?: string
          accent?: string
          audience: string
          role_targets?: string[]
          class_targets?: string[]
          user_targets?: string[]
          status?: string
          published_at?: string | null
          expires_at?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          school_id?: string | null
          created_by?: string | null
          title?: string
          body?: string
          accent?: string
          audience?: string
          role_targets?: string[]
          class_targets?: string[]
          user_targets?: string[]
          status?: string
          published_at?: string | null
          expires_at?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: []
      }
      academic_years: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          end_date: string
          id: string
          is_current: boolean | null
          name: string
          school_id: string
          start_date: string
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          end_date: string
          id?: string
          is_current?: boolean | null
          name: string
          school_id: string
          start_date: string
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          end_date?: string
          id?: string
          is_current?: boolean | null
          name?: string
          school_id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_years_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_years_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_years_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_logs: {
        Row: {
          action: string
          created_at: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          resource_id: string | null
          resource_type: string | null
          school_id: string | null
          session_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          school_id?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          school_id?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      additional_charges: {
        Row: {
          amount: number
          applied_at: string | null
          category: string
          created_at: string | null
          created_by: string | null
          description: string
          id: string
          invoice_id: string | null
          notes: string | null
          school_id: string
          status: string | null
          student_id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          applied_at?: string | null
          category: string
          created_at?: string | null
          created_by?: string | null
          description: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          school_id: string
          status?: string | null
          student_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          applied_at?: string | null
          category?: string
          created_at?: string | null
          created_by?: string | null
          description?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          school_id?: string
          status?: string | null
          student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "additional_charges_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "additional_charges_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "additional_charges_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "additional_charges_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "additional_charges_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "additional_charges_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      admin_action_audit: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          created_at: string
          detail: Json | null
          id: number
          ip_address: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          detail?: Json | null
          id?: number
          ip_address?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          detail?: Json | null
          id?: number
          ip_address?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          permissions: Json | null
          rate_limit: number | null
          revoked_at: string | null
          school_id: string
          total_requests: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          permissions?: Json | null
          rate_limit?: number | null
          revoked_at?: string | null
          school_id: string
          total_requests?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          permissions?: Json | null
          rate_limit?: number | null
          revoked_at?: string | null
          school_id?: string
          total_requests?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "api_keys_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          created_at: string | null
          created_by: string | null
          date: string
          deleted_at: string | null
          host_id: string | null
          id: string
          notes: string | null
          phone: string | null
          purpose: string
          school_id: string
          status: string | null
          time: string | null
          visitor_name: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          date: string
          deleted_at?: string | null
          host_id?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          purpose: string
          school_id: string
          status?: string | null
          time?: string | null
          visitor_name: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          date?: string
          deleted_at?: string | null
          host_id?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          purpose?: string
          school_id?: string
          status?: string | null
          time?: string | null
          visitor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "appointments_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "appointments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          check_in_time: string | null
          check_out_time: string | null
          class_id: string
          created_at: string | null
          created_by: string | null
          date: string | null
          deleted_at: string | null
          id: string
          marked_by: string | null
          notes: string | null
          school_id: string
          status: string
          student_id: string
          updated_by: string | null
        }
        Insert: {
          check_in_time?: string | null
          check_out_time?: string | null
          class_id: string
          created_at?: string | null
          created_by?: string | null
          date?: string | null
          deleted_at?: string | null
          id?: string
          marked_by?: string | null
          notes?: string | null
          school_id: string
          status: string
          student_id: string
          updated_by?: string | null
        }
        Update: {
          check_in_time?: string | null
          check_out_time?: string | null
          class_id?: string
          created_at?: string | null
          created_by?: string | null
          date?: string | null
          deleted_at?: string | null
          id?: string
          marked_by?: string | null
          notes?: string | null
          school_id?: string
          status?: string
          student_id?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "attendance_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "attendance_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "attendance_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          changed_fields: string[] | null
          created_at: string | null
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          school_id: string | null
          table_name: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changed_fields?: string[] | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          school_id?: string | null
          table_name: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_fields?: string[] | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          school_id?: string | null
          table_name?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_logs: {
        Row: {
          backup_type: string
          completed_at: string | null
          created_at: string | null
          id: string
          initiated_by: string | null
          notes: string | null
          school_id: string | null
          size_bytes: number | null
          started_at: string | null
          status: string | null
          storage_path: string | null
        }
        Insert: {
          backup_type: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          initiated_by?: string | null
          notes?: string | null
          school_id?: string | null
          size_bytes?: number | null
          started_at?: string | null
          status?: string | null
          storage_path?: string | null
        }
        Update: {
          backup_type?: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          initiated_by?: string | null
          notes?: string | null
          school_id?: string | null
          size_bytes?: number | null
          started_at?: string | null
          status?: string | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "backup_logs_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backup_logs_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "backup_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backup_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backup_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      call_log: {
        Row: {
          caller_name: string
          created_at: string | null
          deleted_at: string | null
          direction: string | null
          duration_seconds: number | null
          id: string
          logged_by: string | null
          notes: string | null
          phone: string | null
          purpose: string | null
          school_id: string
        }
        Insert: {
          caller_name: string
          created_at?: string | null
          deleted_at?: string | null
          direction?: string | null
          duration_seconds?: number | null
          id?: string
          logged_by?: string | null
          notes?: string | null
          phone?: string | null
          purpose?: string | null
          school_id: string
        }
        Update: {
          caller_name?: string
          created_at?: string | null
          deleted_at?: string | null
          direction?: string | null
          duration_seconds?: number | null
          id?: string
          logged_by?: string | null
          notes?: string | null
          phone?: string | null
          purpose?: string | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_log_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_log_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "call_log_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_log_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_log_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      class_enrollments: {
        Row: {
          academic_year_id: string | null
          class_id: string
          deleted_at: string | null
          enrolled_at: string | null
          id: string
          school_id: string
          student_id: string
        }
        Insert: {
          academic_year_id?: string | null
          class_id: string
          deleted_at?: string | null
          enrolled_at?: string | null
          id?: string
          school_id: string
          student_id: string
        }
        Update: {
          academic_year_id?: string | null
          class_id?: string
          deleted_at?: string | null
          enrolled_at?: string | null
          id?: string
          school_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_enrollments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      classes: {
        Row: {
          academic_year_id: string | null
          capacity: number | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          grade_level: string | null
          id: string
          name: string
          room_number: string | null
          school_id: string
          section: string | null
          teacher_id: string | null
          updated_by: string | null
        }
        Insert: {
          academic_year_id?: string | null
          capacity?: number | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          grade_level?: string | null
          id?: string
          name: string
          room_number?: string | null
          school_id: string
          section?: string | null
          teacher_id?: string | null
          updated_by?: string | null
        }
        Update: {
          academic_year_id?: string | null
          capacity?: number | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          grade_level?: string | null
          id?: string
          name?: string
          room_number?: string | null
          school_id?: string
          section?: string | null
          teacher_id?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "classes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      dashboard_metrics: {
        Row: {
          id: string
          metadata: Json | null
          metric_key: string
          metric_value: number
          previous_value: number | null
          school_id: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          metadata?: Json | null
          metric_key: string
          metric_value?: number
          previous_value?: number | null
          school_id?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          metadata?: Json | null
          metric_key?: string
          metric_value?: number
          previous_value?: number | null
          school_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_metrics_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_metrics_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_metrics_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      data_exports: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          export_type: string
          file_size_bytes: number | null
          file_url: string | null
          filters: Json | null
          id: string
          row_count: number | null
          school_id: string | null
          status: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          export_type: string
          file_size_bytes?: number | null
          file_url?: string | null
          filters?: Json | null
          id?: string
          row_count?: number | null
          school_id?: string | null
          status?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          export_type?: string
          file_size_bytes?: number | null
          file_url?: string | null
          filters?: Json | null
          id?: string
          row_count?: number | null
          school_id?: string | null
          status?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_exports_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_exports_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_exports_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_exports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_exports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      employees: {
        Row: {
          bank_account: string | null
          created_at: string | null
          date_of_joining: string | null
          deleted_at: string | null
          department: string | null
          designation: string | null
          employee_code: string | null
          employment_type: string | null
          id: string
          pan_number: string | null
          profile_id: string
          school_id: string
          staff_person_name: string | null
          status: string | null
        }
        Insert: {
          bank_account?: string | null
          created_at?: string | null
          date_of_joining?: string | null
          deleted_at?: string | null
          department?: string | null
          designation?: string | null
          employee_code?: string | null
          employment_type?: string | null
          id?: string
          pan_number?: string | null
          profile_id: string
          school_id: string
          staff_person_name?: string | null
          status?: string | null
        }
        Update: {
          bank_account?: string | null
          created_at?: string | null
          date_of_joining?: string | null
          deleted_at?: string | null
          department?: string | null
          designation?: string | null
          employee_code?: string | null
          employment_type?: string | null
          id?: string
          pan_number?: string | null
          profile_id?: string
          school_id?: string
          staff_person_name?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "employees_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          category: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          end_date: string | null
          event_date: string
          id: string
          is_all_day: boolean | null
          location: string | null
          school_id: string | null
          title: string
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          event_date: string
          id?: string
          is_all_day?: boolean | null
          location?: string | null
          school_id?: string | null
          title: string
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          event_date?: string
          id?: string
          is_all_day?: boolean | null
          location?: string | null
          school_id?: string | null
          title?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      exam_results: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          exam_subject_id: string
          grade: string | null
          graded_by: string | null
          id: string
          is_absent: boolean | null
          marks_obtained: number | null
          remarks: string | null
          school_id: string
          student_id: string
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          exam_subject_id: string
          grade?: string | null
          graded_by?: string | null
          id?: string
          is_absent?: boolean | null
          marks_obtained?: number | null
          remarks?: string | null
          school_id: string
          student_id: string
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          exam_subject_id?: string
          grade?: string | null
          graded_by?: string | null
          id?: string
          is_absent?: boolean | null
          marks_obtained?: number | null
          remarks?: string | null
          school_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_results_exam_subject_id_fkey"
            columns: ["exam_subject_id"]
            isOneToOne: false
            referencedRelation: "exam_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_results_graded_by_fkey"
            columns: ["graded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_results_graded_by_fkey"
            columns: ["graded_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "exam_results_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_results_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_results_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      exam_subjects: {
        Row: {
          class_id: string
          created_at: string | null
          deleted_at: string | null
          end_time: string | null
          exam_date: string | null
          exam_id: string
          id: string
          max_marks: number
          passing_marks: number
          room: string | null
          school_id: string
          start_time: string | null
          subject_id: string
        }
        Insert: {
          class_id: string
          created_at?: string | null
          deleted_at?: string | null
          end_time?: string | null
          exam_date?: string | null
          exam_id: string
          id?: string
          max_marks?: number
          passing_marks?: number
          room?: string | null
          school_id: string
          start_time?: string | null
          subject_id: string
        }
        Update: {
          class_id?: string
          created_at?: string | null
          deleted_at?: string | null
          end_time?: string | null
          exam_date?: string | null
          exam_id?: string
          id?: string
          max_marks?: number
          passing_marks?: number
          room?: string | null
          school_id?: string
          start_time?: string | null
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_subjects_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_subjects_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          academic_year_id: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          end_date: string | null
          exam_type: string | null
          id: string
          name: string
          school_id: string
          start_date: string | null
          status: string | null
          updated_by: string | null
        }
        Insert: {
          academic_year_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          exam_type?: string | null
          id?: string
          name: string
          school_id: string
          start_date?: string | null
          status?: string | null
          updated_by?: string | null
        }
        Update: {
          academic_year_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          exam_type?: string | null
          id?: string
          name?: string
          school_id?: string
          start_date?: string | null
          status?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exams_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "exams_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      failed_jobs: {
        Row: {
          attempts: number | null
          created_at: string | null
          error_message: string | null
          error_stack: string | null
          id: string
          job_type: string
          last_attempted_at: string | null
          max_attempts: number | null
          payload: Json | null
          queue: string | null
          resolved_at: string | null
          resolved_by: string | null
          school_id: string | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          error_message?: string | null
          error_stack?: string | null
          id?: string
          job_type: string
          last_attempted_at?: string | null
          max_attempts?: number | null
          payload?: Json | null
          queue?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          school_id?: string | null
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          error_message?: string | null
          error_stack?: string | null
          id?: string
          job_type?: string
          last_attempted_at?: string | null
          max_attempts?: number | null
          payload?: Json | null
          queue?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          school_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "failed_jobs_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "failed_jobs_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "failed_jobs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "failed_jobs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "failed_jobs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string | null
          feature_key: string
          id: string
          is_enabled: boolean | null
          metadata: Json | null
          school_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          feature_key: string
          id?: string
          is_enabled?: boolean | null
          metadata?: Json | null
          school_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          feature_key?: string
          id?: string
          is_enabled?: boolean | null
          metadata?: Json | null
          school_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flags_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flags_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_plan_items: {
        Row: {
          amount: number
          created_at: string | null
          fee_head_id: string | null
          id: string
          is_optional: boolean | null
          label: string
          plan_id: string
          school_id: string
          sort_order: number | null
          tax: number | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          fee_head_id?: string | null
          id?: string
          is_optional?: boolean | null
          label: string
          plan_id: string
          school_id: string
          sort_order?: number | null
          tax?: number | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          fee_head_id?: string | null
          id?: string
          is_optional?: boolean | null
          label?: string
          plan_id?: string
          school_id?: string
          sort_order?: number | null
          tax?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_plan_items_fee_head_id_fkey"
            columns: ["fee_head_id"]
            isOneToOne: false
            referencedRelation: "fee_structures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_plan_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "fee_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_plan_items_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_plan_items_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_plan_items_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_plans: {
        Row: {
          academic_year_id: string | null
          class_id: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          due_day_of_month: number | null
          frequency: string
          id: string
          is_active: boolean | null
          late_fee_amount: number | null
          late_fee_grace_days: number | null
          name: string
          notes: string | null
          school_id: string
          section: string | null
          updated_at: string | null
        }
        Insert: {
          academic_year_id?: string | null
          class_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          due_day_of_month?: number | null
          frequency: string
          id?: string
          is_active?: boolean | null
          late_fee_amount?: number | null
          late_fee_grace_days?: number | null
          name: string
          notes?: string | null
          school_id: string
          section?: string | null
          updated_at?: string | null
        }
        Update: {
          academic_year_id?: string | null
          class_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          due_day_of_month?: number | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          late_fee_amount?: number | null
          late_fee_grace_days?: number | null
          name?: string
          notes?: string | null
          school_id?: string
          section?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_plans_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_plans_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_plans_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_plans_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_plans_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_structures: {
        Row: {
          academic_year_id: string | null
          amount: number
          class_id: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          frequency: string | null
          id: string
          is_mandatory: boolean | null
          name: string
          school_id: string
          updated_by: string | null
        }
        Insert: {
          academic_year_id?: string | null
          amount: number
          class_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          frequency?: string | null
          id?: string
          is_mandatory?: boolean | null
          name: string
          school_id: string
          updated_by?: string | null
        }
        Update: {
          academic_year_id?: string | null
          amount?: number
          class_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          frequency?: string | null
          id?: string
          is_mandatory?: boolean | null
          name?: string
          school_id?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_structures_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "fee_structures_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      grading_scales: {
        Row: {
          created_at: string | null
          id: string
          is_default: boolean | null
          name: string
          ranges: Json
          scale_type: string
          school_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          ranges?: Json
          scale_type: string
          school_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          ranges?: Json
          scale_type?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grading_scales_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grading_scales_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grading_scales_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      homework: {
        Row: {
          attachments: Json | null
          class_id: string
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          due_date: string
          id: string
          max_marks: number | null
          school_id: string
          status: string | null
          subject_id: string | null
          teacher_id: string | null
          title: string
          updated_by: string | null
        }
        Insert: {
          attachments?: Json | null
          class_id: string
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date: string
          id?: string
          max_marks?: number | null
          school_id: string
          status?: string | null
          subject_id?: string | null
          teacher_id?: string | null
          title: string
          updated_by?: string | null
        }
        Update: {
          attachments?: Json | null
          class_id?: string
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string
          id?: string
          max_marks?: number | null
          school_id?: string
          status?: string | null
          subject_id?: string | null
          teacher_id?: string | null
          title?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "homework_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "homework_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          attachments: Json | null
          content: string | null
          feedback: string | null
          graded_at: string | null
          graded_by: string | null
          homework_id: string
          id: string
          marks_obtained: number | null
          school_id: string
          student_id: string
          submitted_at: string | null
        }
        Insert: {
          attachments?: Json | null
          content?: string | null
          feedback?: string | null
          graded_at?: string | null
          graded_by?: string | null
          homework_id: string
          id?: string
          marks_obtained?: number | null
          school_id: string
          student_id: string
          submitted_at?: string | null
        }
        Update: {
          attachments?: Json | null
          content?: string | null
          feedback?: string | null
          graded_at?: string | null
          graded_by?: string | null
          homework_id?: string
          id?: string
          marks_obtained?: number | null
          school_id?: string
          student_id?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_submissions_graded_by_fkey"
            columns: ["graded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_graded_by_fkey"
            columns: ["graded_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "homework_submissions_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "homework"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      inquiries: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          deleted_at: string | null
          email: string | null
          follow_up_date: string | null
          grade_applying: string | null
          id: string
          notes: string | null
          parent_name: string | null
          phone: string
          school_id: string
          source: string | null
          status: string | null
          student_name: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          follow_up_date?: string | null
          grade_applying?: string | null
          id?: string
          notes?: string | null
          parent_name?: string | null
          phone: string
          school_id: string
          source?: string | null
          status?: string | null
          student_name: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          follow_up_date?: string | null
          grade_applying?: string | null
          id?: string
          notes?: string | null
          parent_name?: string | null
          phone?: string
          school_id?: string
          source?: string | null
          status?: string | null
          student_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "inquiries_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inquiries_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "inquiries_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inquiries_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inquiries_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount: number
          created_at: string | null
          discount: number | null
          fee_head_id: string | null
          id: string
          invoice_id: string
          label: string
          school_id: string
          sort_order: number | null
          tax: number | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          discount?: number | null
          fee_head_id?: string | null
          id?: string
          invoice_id: string
          label: string
          school_id: string
          sort_order?: number | null
          tax?: number | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          discount?: number | null
          fee_head_id?: string | null
          id?: string
          invoice_id?: string
          label?: string
          school_id?: string
          sort_order?: number | null
          tax?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_fee_head_id_fkey"
            columns: ["fee_head_id"]
            isOneToOne: false
            referencedRelation: "fee_structures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          assignment_id: string | null
          billing_period_end: string | null
          billing_period_start: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          discount: number | null
          due_date: string
          id: string
          invoice_number: string | null
          items: Json | null
          late_fee: number | null
          notes: string | null
          paid_amount: number | null
          paid_at: string | null
          payment_method: string | null
          period_label: string | null
          receipt_count: number | null
          school_id: string
          status: string | null
          student_id: string | null
          tax: number | null
          updated_by: string | null
        }
        Insert: {
          amount: number
          assignment_id?: string | null
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          discount?: number | null
          due_date: string
          id?: string
          invoice_number?: string | null
          items?: Json | null
          late_fee?: number | null
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_method?: string | null
          period_label?: string | null
          receipt_count?: number | null
          school_id: string
          status?: string | null
          student_id?: string | null
          tax?: number | null
          updated_by?: string | null
        }
        Update: {
          amount?: number
          assignment_id?: string | null
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          discount?: number | null
          due_date?: string
          id?: string
          invoice_number?: string | null
          items?: Json | null
          late_fee?: number | null
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_method?: string | null
          period_label?: string | null
          receipt_count?: number | null
          school_id?: string
          status?: string | null
          student_id?: string | null
          tax?: number | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "student_fee_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "invoices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "invoices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          days: number
          employee_id: string
          end_date: string
          id: string
          leave_type: string
          reason: string | null
          rejection_reason: string | null
          school_id: string
          start_date: string
          status: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          days: number
          employee_id: string
          end_date: string
          id?: string
          leave_type: string
          reason?: string | null
          rejection_reason?: string | null
          school_id: string
          start_date: string
          status?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          days?: number
          employee_id?: string
          end_date?: string
          id?: string
          leave_type?: string
          reason?: string | null
          rejection_reason?: string | null
          school_id?: string
          start_date?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          country: string | null
          created_at: string | null
          email: string
          failure_reason: string | null
          id: string
          ip_address: string
          success: boolean
          user_agent: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string | null
          email: string
          failure_reason?: string | null
          id?: string
          ip_address: string
          success?: boolean
          user_agent?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string | null
          email?: string
          failure_reason?: string | null
          id?: string
          ip_address?: string
          success?: boolean
          user_agent?: string | null
        }
        Relationships: []
      }
      memberships: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          id: string
          joined_at: string | null
          role_id: string | null
          school_id: string
          status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          joined_at?: string | null
          role_id?: string | null
          school_id: string
          status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          joined_at?: string | null
          role_id?: string | null
          school_id?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      message_threads: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string
          is_archived: boolean | null
          school_id: string
          subject: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_archived?: boolean | null
          school_id: string
          subject?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_archived?: boolean | null
          school_id?: string
          subject?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_threads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_threads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "message_threads_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_threads_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_threads_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json | null
          content: string
          created_at: string | null
          deleted_at: string | null
          edited_at: string | null
          id: string
          is_edited: boolean | null
          sender_id: string | null
          thread_id: string
        }
        Insert: {
          attachments?: Json | null
          content: string
          created_at?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_edited?: boolean | null
          sender_id?: string | null
          thread_id: string
        }
        Update: {
          attachments?: Json | null
          content?: string
          created_at?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_edited?: boolean | null
          sender_id?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_audit: {
        Row: {
          action: string
          affected_profile_id: string | null
          applied_at: string
          id: number
          migration_name: string
          payload: Json | null
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: string
          affected_profile_id?: string | null
          applied_at?: string
          id?: number
          migration_name: string
          payload?: Json | null
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: string
          affected_profile_id?: string | null
          applied_at?: string
          id?: number
          migration_name?: string
          payload?: Json | null
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_url: string | null
          channel: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          is_read: boolean | null
          message: string
          metadata: Json | null
          school_id: string | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          action_url?: string | null
          channel?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          metadata?: Json | null
          school_id?: string | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          action_url?: string | null
          channel?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          metadata?: Json | null
          school_id?: string | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      online_classes: {
        Row: {
          class_id: string
          created_at: string | null
          deleted_at: string | null
          duration_minutes: number | null
          id: string
          meeting_url: string | null
          platform: string | null
          recording_url: string | null
          scheduled_at: string
          school_id: string
          status: string | null
          subject_id: string | null
          teacher_id: string | null
          title: string
        }
        Insert: {
          class_id: string
          created_at?: string | null
          deleted_at?: string | null
          duration_minutes?: number | null
          id?: string
          meeting_url?: string | null
          platform?: string | null
          recording_url?: string | null
          scheduled_at: string
          school_id: string
          status?: string | null
          subject_id?: string | null
          teacher_id?: string | null
          title: string
        }
        Update: {
          class_id?: string
          created_at?: string | null
          deleted_at?: string | null
          duration_minutes?: number | null
          id?: string
          meeting_url?: string | null
          platform?: string | null
          recording_url?: string | null
          scheduled_at?: string
          school_id?: string
          status?: string | null
          subject_id?: string | null
          teacher_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_classes_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_classes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_classes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      parent_student: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_primary: boolean | null
          parent_id: string
          relationship: string | null
          school_id: string
          status: string
          student_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_primary?: boolean | null
          parent_id: string
          relationship?: string | null
          school_id: string
          status?: string
          student_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_primary?: boolean | null
          parent_id?: string
          relationship?: string | null
          school_id?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_student_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_student_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "parent_student_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_student_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      password_recovery_audit: {
        Row: {
          created_at: string
          id: number
          ip_address: string | null
          login_id: string
          recovery_link: string | null
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          ip_address?: string | null
          login_id: string
          recovery_link?: string | null
          status: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          ip_address?: string | null
          login_id?: string
          recovery_link?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      password_resets: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          ip_address: string | null
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          bank_name: string | null
          card_brand: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          last_four: string | null
          metadata: Json | null
          provider: string | null
          school_id: string
          type: string
          upi_id: string | null
        }
        Insert: {
          bank_name?: string | null
          card_brand?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          last_four?: string | null
          metadata?: Json | null
          provider?: string | null
          school_id: string
          type: string
          upi_id?: string | null
        }
        Update: {
          bank_name?: string | null
          card_brand?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          last_four?: string | null
          metadata?: Json | null
          provider?: string | null
          school_id?: string
          type?: string
          upi_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          action: string
          created_at: string | null
          description: string | null
          id: string
          module: string
        }
        Insert: {
          action: string
          created_at?: string | null
          description?: string | null
          id?: string
          module: string
        }
        Update: {
          action?: string
          created_at?: string | null
          description?: string | null
          id?: string
          module?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          interval_months: number
          is_active: boolean
          name: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id: string
          interval_months: number
          is_active?: boolean
          name: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          interval_months?: number
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          created_at: string | null
          date_of_birth: string | null
          deleted_at: string | null
          email: string
          emergency_contact: string | null
          full_name: string | null
          gender: string | null
          id: string
          is_active: boolean | null
          login_id: string | null
          metadata: Json | null
          phone: string | null
          phone_verified: boolean
          recovery_email: string | null
          recovery_email_verified: boolean
          role: string
          school_id: string | null
          student_status: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email: string
          emergency_contact?: string | null
          full_name?: string | null
          gender?: string | null
          id: string
          is_active?: boolean | null
          login_id?: string | null
          metadata?: Json | null
          phone?: string | null
          phone_verified?: boolean
          recovery_email?: string | null
          recovery_email_verified?: boolean
          role: string
          school_id?: string | null
          student_status?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string
          emergency_contact?: string | null
          full_name?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          login_id?: string | null
          metadata?: Json | null
          phone?: string | null
          phone_verified?: boolean
          recovery_email?: string | null
          recovery_email_verified?: boolean
          role?: string
          school_id?: string | null
          student_status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      recovery_email_otp: {
        Row: {
          code_hash: string
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          user_id: string
        }
        Insert: {
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          user_id: string
        }
        Update: {
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string | null
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_system: boolean | null
          name: string
          school_id: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          school_id?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          school_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      salary: {
        Row: {
          allowances: number | null
          basic_salary: number
          created_at: string | null
          deductions: number | null
          deleted_at: string | null
          employee_id: string
          id: string
          month: number
          net_salary: number | null
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          school_id: string
          status: string | null
          year: number
        }
        Insert: {
          allowances?: number | null
          basic_salary: number
          created_at?: string | null
          deductions?: number | null
          deleted_at?: string | null
          employee_id: string
          id?: string
          month: number
          net_salary?: number | null
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          school_id: string
          status?: string | null
          year: number
        }
        Update: {
          allowances?: number | null
          basic_salary?: number
          created_at?: string | null
          deductions?: number | null
          deleted_at?: string | null
          employee_id?: string
          id?: string
          month?: number
          net_salary?: number | null
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          school_id?: string
          status?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "salary_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "salary_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      school_backups: {
        Row: {
          archive_name: string
          checksum_sha256: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          row_counts: Json | null
          school_id: string
          school_name: string
          size_bytes: number | null
          status: string
          storage_path: string | null
          validated: boolean | null
        }
        Insert: {
          archive_name: string
          checksum_sha256?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          row_counts?: Json | null
          school_id: string
          school_name: string
          size_bytes?: number | null
          status?: string
          storage_path?: string | null
          validated?: boolean | null
        }
        Update: {
          archive_name?: string
          checksum_sha256?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          row_counts?: Json | null
          school_id?: string
          school_name?: string
          size_bytes?: number | null
          status?: string
          storage_path?: string | null
          validated?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "school_backups_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_backups_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_backups_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      school_subscriptions: {
        Row: {
          billing_cycle: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string | null
          current_period_end: string
          current_period_start: string
          id: string
          payment_method_id: string | null
          plan_id: string
          school_id: string
          status: string
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          billing_cycle?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          current_period_end?: string
          current_period_start?: string
          id?: string
          payment_method_id?: string | null
          plan_id: string
          school_id: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          billing_cycle?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          current_period_end?: string
          current_period_start?: string
          id?: string
          payment_method_id?: string | null
          plan_id?: string
          school_id?: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sub_payment_method"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_subscriptions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_subscriptions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_subscriptions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          address: string | null
          archived_at: string | null
          city: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          email: string | null
          email_domain: string | null
          id: string
          logo_url: string | null
          manual_unlock_until: string | null
          max_students: number | null
          name: string
          next_due_date: string | null
          phone: string | null
          plan_id: string | null
          settings: Json | null
          slug: string | null
          state: string | null
          status: string | null
          subdomain: string | null
          subscription_start_date: string | null
          subscription_status:
            | Database["public"]["Enums"]["subscription_status_t"]
            | null
          subscription_tier: string | null
          updated_at: string | null
          updated_by: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          email_domain?: string | null
          id?: string
          logo_url?: string | null
          manual_unlock_until?: string | null
          max_students?: number | null
          name: string
          next_due_date?: string | null
          phone?: string | null
          plan_id?: string | null
          settings?: Json | null
          slug?: string | null
          state?: string | null
          status?: string | null
          subdomain?: string | null
          subscription_start_date?: string | null
          subscription_status?:
            | Database["public"]["Enums"]["subscription_status_t"]
            | null
          subscription_tier?: string | null
          updated_at?: string | null
          updated_by?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          email_domain?: string | null
          id?: string
          logo_url?: string | null
          manual_unlock_until?: string | null
          max_students?: number | null
          name?: string
          next_due_date?: string | null
          phone?: string | null
          plan_id?: string | null
          settings?: Json | null
          slug?: string | null
          state?: string | null
          status?: string | null
          subdomain?: string | null
          subscription_start_date?: string | null
          subscription_status?:
            | Database["public"]["Enums"]["subscription_status_t"]
            | null
          subscription_tier?: string | null
          updated_at?: string | null
          updated_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "schools_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schools_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schools_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      storage_usage: {
        Row: {
          bucket: string
          bytes_used: number | null
          file_count: number | null
          id: string
          max_bytes: number | null
          school_id: string
          updated_at: string | null
        }
        Insert: {
          bucket?: string
          bytes_used?: number | null
          file_count?: number | null
          id?: string
          max_bytes?: number | null
          school_id: string
          updated_at?: string | null
        }
        Update: {
          bucket?: string
          bytes_used?: number | null
          file_count?: number | null
          id?: string
          max_bytes?: number | null
          school_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_usage_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_usage_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_usage_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      student_fee_assignments: {
        Row: {
          created_at: string | null
          created_by: string | null
          discount_pct: number | null
          end_date: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          plan_id: string
          scholarship_amount: number | null
          school_id: string
          start_date: string
          student_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          discount_pct?: number | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          plan_id: string
          scholarship_amount?: number | null
          school_id: string
          start_date?: string
          student_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          discount_pct?: number | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          plan_id?: string
          scholarship_amount?: number | null
          school_id?: string
          start_date?: string
          student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_fee_assignments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "fee_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_fee_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_fee_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_fee_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_fee_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_fee_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      subject_teachers: {
        Row: {
          academic_year_id: string | null
          class_id: string
          created_at: string | null
          id: string
          is_primary: boolean | null
          school_id: string
          subject_id: string
          teacher_id: string
        }
        Insert: {
          academic_year_id?: string | null
          class_id: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          school_id: string
          subject_id: string
          teacher_id: string
        }
        Update: {
          academic_year_id?: string | null
          class_id?: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          school_id?: string
          subject_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_teachers_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_teachers_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_teachers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_teachers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_teachers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_teachers_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_teachers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_teachers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      subjects: {
        Row: {
          class_id: string | null
          code: string | null
          created_at: string | null
          created_by: string | null
          credits: number | null
          deleted_at: string | null
          description: string | null
          id: string
          is_elective: boolean | null
          name: string
          school_id: string
          teacher_id: string | null
          updated_by: string | null
        }
        Insert: {
          class_id?: string | null
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          credits?: number | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_elective?: boolean | null
          name: string
          school_id: string
          teacher_id?: string | null
          updated_by?: string | null
        }
        Update: {
          class_id?: string | null
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          credits?: number | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_elective?: boolean | null
          name?: string
          school_id?: string
          teacher_id?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subjects_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "subjects_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      teacher_assignment_history: {
        Row: {
          id: string
          school_id: string
          teacher_id: string | null
          teacher_name_at_time: string | null
          employee_id_at_time: string | null
          designation_at_time: string | null
          assignment_type: string
          class_id: string | null
          class_name_at_time: string | null
          subject_id: string | null
          subject_name_at_time: string | null
          source_assignment_id: string | null
          assigned_at: string | null
          ended_at: string
          unassigned_by: string | null
          unassigned_by_name_at_time: string | null
          ended_reason: string
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          school_id: string
          teacher_id?: string | null
          teacher_name_at_time?: string | null
          employee_id_at_time?: string | null
          designation_at_time?: string | null
          assignment_type: string
          class_id?: string | null
          class_name_at_time?: string | null
          subject_id?: string | null
          subject_name_at_time?: string | null
          source_assignment_id?: string | null
          assigned_at?: string | null
          ended_at?: string
          unassigned_by?: string | null
          unassigned_by_name_at_time?: string | null
          ended_reason?: string
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          school_id?: string
          teacher_id?: string | null
          teacher_name_at_time?: string | null
          employee_id_at_time?: string | null
          designation_at_time?: string | null
          assignment_type?: string
          class_id?: string | null
          class_name_at_time?: string | null
          subject_id?: string | null
          subject_name_at_time?: string | null
          source_assignment_id?: string | null
          assigned_at?: string | null
          ended_at?: string
          unassigned_by?: string | null
          unassigned_by_name_at_time?: string | null
          ended_reason?: string
          metadata?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      subscription_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          metadata: Json | null
          school_id: string
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          school_id: string
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          school_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string | null
          features: Json | null
          id: string
          is_active: boolean | null
          max_admins: number | null
          max_storage_mb: number | null
          max_students: number | null
          max_teachers: number | null
          name: string
          price_annual: number
          price_monthly: number
          slug: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          max_admins?: number | null
          max_storage_mb?: number | null
          max_students?: number | null
          max_teachers?: number | null
          name: string
          price_annual?: number
          price_monthly?: number
          slug: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          max_admins?: number | null
          max_storage_mb?: number | null
          max_students?: number | null
          max_teachers?: number | null
          name?: string
          price_annual?: number
          price_monthly?: number
          slug?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          category: string
          created_at: string | null
          id: string
          is_resolved: boolean | null
          message: string | null
          resolved_at: string | null
          resolved_by: string | null
          school_id: string | null
          severity: string
          title: string
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          message?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          school_id?: string | null
          severity: string
          title: string
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          message?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          school_id?: string | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "system_alerts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_alerts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_alerts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          action: string | null
          category: string
          created_at: string | null
          details: Json | null
          id: string
          ip_address: string | null
          level: string
          message: string
          metadata: Json | null
          school_id: string | null
          status: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          category: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: string | null
          level: string
          message: string
          metadata?: Json | null
          school_id?: string | null
          status?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          category?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: string | null
          level?: string
          message?: string
          metadata?: Json | null
          school_id?: string | null
          status?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_participants: {
        Row: {
          id: string
          is_muted: boolean | null
          joined_at: string | null
          last_read_at: string | null
          thread_id: string
          user_id: string
        }
        Insert: {
          id?: string
          is_muted?: boolean | null
          joined_at?: string | null
          last_read_at?: string | null
          thread_id: string
          user_id: string
        }
        Update: {
          id?: string
          is_muted?: boolean | null
          joined_at?: string | null
          last_read_at?: string | null
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_participants_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      timetable: {
        Row: {
          class_id: string
          created_at: string | null
          day_of_week: number
          deleted_at: string | null
          end_time: string
          id: string
          room: string | null
          school_id: string
          start_time: string
          subject_id: string
          teacher_id: string | null
        }
        Insert: {
          class_id: string
          created_at?: string | null
          day_of_week: number
          deleted_at?: string | null
          end_time: string
          id?: string
          room?: string | null
          school_id: string
          start_time: string
          subject_id: string
          teacher_id?: string | null
        }
        Update: {
          class_id?: string
          created_at?: string | null
          day_of_week?: number
          deleted_at?: string | null
          end_time?: string
          id?: string
          room?: string | null
          school_id?: string
          start_time?: string
          subject_id?: string
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timetable_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          payment_method: string | null
          processed_by: string | null
          reference_number: string | null
          school_id: string
          status: string | null
          student_id: string | null
          type: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          payment_method?: string | null
          processed_by?: string | null
          reference_number?: string | null
          school_id: string
          status?: string | null
          student_id?: string | null
          type: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          payment_method?: string | null
          processed_by?: string | null
          reference_number?: string | null
          school_id?: string
          status?: string | null
          student_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "transactions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          device_info: Json | null
          ended_at: string | null
          expires_at: string | null
          id: string
          ip_address: string | null
          is_active: boolean | null
          last_active_at: string | null
          started_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          device_info?: Json | null
          ended_at?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean | null
          last_active_at?: string | null
          started_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          device_info?: Json | null
          ended_at?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean | null
          last_active_at?: string | null
          started_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      visitors: {
        Row: {
          badge_number: string | null
          check_in: string | null
          check_out: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          id_proof_number: string | null
          id_proof_type: string | null
          logged_by: string | null
          notes: string | null
          phone: string | null
          purpose: string
          school_id: string
          visitor_name: string
          whom_to_meet: string | null
          whom_to_meet_id: string | null
        }
        Insert: {
          badge_number?: string | null
          check_in?: string | null
          check_out?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          id_proof_number?: string | null
          id_proof_type?: string | null
          logged_by?: string | null
          notes?: string | null
          phone?: string | null
          purpose: string
          school_id: string
          visitor_name: string
          whom_to_meet?: string | null
          whom_to_meet_id?: string | null
        }
        Update: {
          badge_number?: string | null
          check_in?: string | null
          check_out?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          id_proof_number?: string | null
          id_proof_type?: string | null
          logged_by?: string | null
          notes?: string | null
          phone?: string | null
          purpose?: string
          school_id?: string
          visitor_name?: string
          whom_to_meet?: string | null
          whom_to_meet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visitors_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitors_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "visitors_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitors_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitors_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitors_whom_to_meet_id_fkey"
            columns: ["whom_to_meet_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitors_whom_to_meet_id_fkey"
            columns: ["whom_to_meet_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          events: string[]
          failure_count: number | null
          headers: Json | null
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          max_retries: number | null
          name: string
          school_id: string
          secret_hash: string | null
          url: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          events?: string[]
          failure_count?: number | null
          headers?: Json | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          max_retries?: number | null
          name: string
          school_id: string
          secret_hash?: string | null
          url: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          events?: string[]
          failure_count?: number | null
          headers?: Json | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          max_retries?: number | null
          name?: string
          school_id?: string
          secret_hash?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "webhooks_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "v_school_subscription_summary"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      invoice_aggregates: {
        Row: {
          paid_count: number | null
          pending_count: number | null
          pending_count_with_overdue: number | null
          total_amount: number | null
          total_outstanding: number | null
          total_paid: number | null
        }
        Relationships: []
      }
      school_summary_metrics: {
        Row: {
          address: string | null
          admin_count: number | null
          admin_email: string | null
          admin_id: string | null
          admin_name: string | null
          city: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          email: string | null
          email_domain: string | null
          id: string | null
          logo_url: string | null
          max_students: number | null
          name: string | null
          phone: string | null
          revenue: number | null
          settings: Json | null
          slug: string | null
          state: string | null
          status: string | null
          student_count: number | null
          subdomain: string | null
          subscription_tier: string | null
          updated_at: string | null
          updated_by: string | null
          website: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "schools_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schools_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "school_summary_metrics"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      v_school_subscription_summary: {
        Row: {
          amount: number | null
          archived_at: string | null
          currency: string | null
          id: string | null
          manual_unlock_until: string | null
          name: string | null
          next_due_date: string | null
          oldest_due_date: string | null
          outstanding_amount: number | null
          plan_id: string | null
          plan_name: string | null
          subscription_status:
            | Database["public"]["Enums"]["subscription_status_t"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "schools_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_manage_recovery_email: {
        Args: { _actor_id: string; _target_user_id: string }
        Returns: boolean
      }
      fn_admin_dashboard_stats: { Args: never; Returns: Json }
      fn_apply_late_fees: { Args: never; Returns: number }
      fn_archive_school: {
        Args: { p_actor: string; p_school: string }
        Returns: undefined
      }
      fn_billing_run: { Args: never; Returns: Json }
      fn_bulk_assign_fee_plan: {
        Args: { p_class: string; p_plan: string }
        Returns: number
      }
      fn_bulk_enroll_students: {
        Args: { p_class: string; p_student_ids: string[] }
        Returns: number
      }
      fn_class_overview: { Args: { p_class: string }; Returns: Json }
      fn_extend_due_date: {
        Args: { p_actor: string; p_days: number; p_school: string }
        Returns: undefined
      }
      fn_extend_invoice_due: {
        Args: { p_days: number; p_invoice: string }
        Returns: undefined
      }
      fn_generate_invoice: { Args: { p_school: string }; Returns: string }
      fn_generate_school_invoice: {
        Args: {
          p_assignment: string
          p_period_end: string
          p_period_label: string
          p_period_start: string
        }
        Returns: string
      }
      fn_can_access_student: {
        Args: { target_student_id: string }
        Returns: boolean
      }
      fn_get_my_linked_students: {
        Args: never
        Returns: {
          student_id: string
          full_name: string | null
          email: string | null
          school_id: string
          relationship: string | null
          is_primary: boolean | null
          status: string
          avatar_url: string | null
          class_name: string | null
          section_name: string | null
        }[]
      }
      fn_student_performance_summary: {
        Args: { target_student_id?: string | null }
        Returns: {
          exam_subject_id: string
          exam_name: string
          subject_name: string
          chapter_name: string | null
          exam_date: string | null
          max_marks: number
          your_score: number | null
          class_average: number | null
        }[]
      }
      fn_get_my_roles: { Args: never; Returns: string[] }
      fn_get_user_roles: {
        Args: { _target_user_id: string }
        Returns: string[]
      }
      fn_search_school_accounts_for_staff: {
        Args: { _query: string; _school_id: string }
        Returns: {
          user_id: string
          email: string
          full_name: string | null
          primary_role: string
          additional_roles: string[]
          is_active: boolean
          staff_name: string | null
          has_teacher_role: boolean
          linked_students: Json
        }[]
      }
      fn_search_guardians_for_student: {
        Args: { _query?: string; _school_id: string }
        Returns: {
          guardian_id: string
          email: string
          full_name: string
          primary_role: string
          roles: string[]
          is_active: boolean
          has_staff_role: boolean
          staff_person_name: string | null
          designation: string | null
          department: string | null
          linked_children_count: number
        }[]
      }
      fn_link_student_guardian: {
        Args: {
          _school_id: string
          _parent_id: string
          _student_id: string
          _relationship?: string
          _is_primary?: boolean
        }
        Returns: Json
      }
      fn_search_students_for_family: {
        Args: {
          _school_id: string
          _query?: string
          _parent_id?: string | null
        }
        Returns: {
          student_id: string
          full_name: string
          login_id: string | null
          class_name: string | null
          section_name: string | null
          already_linked: boolean
        }[]
      }
      fn_unlink_student_guardian: {
        Args: {
          _school_id: string
          _link_id: string
        }
        Returns: Json
      }
      fn_update_guardian_relationship: {
        Args: {
          _school_id: string
          _link_id: string
          _relationship: string
          _is_primary?: boolean | null
        }
        Returns: Json
      }
      fn_set_student_status: {
        Args: {
          _school_id: string
          _student_id: string
          _new_status: string
          _reason?: string | null
          _notes?: string | null
        }
        Returns: Json
      }
      fn_check_student_delete_eligibility: {
        Args: {
          _school_id: string
          _student_id: string
        }
        Returns: Json
      }
      fn_get_teacher_active_assignments: {
        Args: {
          _school_id: string
          _teacher_profile_id: string
        }
        Returns: {
          has_active_assignments: boolean
          total_count: number
          classes: {
            class_id: string
            name: string
            section: string | null
            grade_level: string | null
            room_number: string | null
          }[]
          subjects: {
            subject_id: string
            name: string
            code: string | null
            class_id: string | null
            class_name: string | null
            class_section: string | null
          }[]
          subject_teachers: {
            id: string
            subject_id: string
            subject_name: string
            class_id: string
            class_name: string
            class_section: string | null
            is_primary: boolean
          }[]
          timetable: {
            id: string
            day_of_week: number
            start_time: string
            end_time: string
            room: string | null
            class_name: string
            class_section: string | null
            subject_name: string
          }[]
          online_classes: {
            id: string
            title: string
            scheduled_at: string
            duration_minutes: number | null
            platform: string | null
            status: string
            class_name: string
            subject_name: string | null
          }[]
        }
      }
      fn_get_my_persona_summary: {
        Args: never
        Returns: Json
      }
      fn_get_profile_family_links: {
        Args: { _target_profile_id: string }
        Returns: Json
      }
      fn_check_staff_pin_status: {
        Args: { _school_id: string; _target_user_id?: string }
        Returns: {
          has_pin: boolean
          must_change: boolean
          is_locked: boolean
          locked_until: string | null
          attempts_remaining: number
          is_temporary: boolean
          success?: boolean
          error?: string
        }
      }
      fn_setup_or_change_staff_pin: {
        Args: {
          _school_id: string
          _target_user_id: string
          _new_pin: string
          _current_pin?: string | null
          _is_temporary?: boolean
        }
        Returns: {
          success: boolean
          error?: string
          must_change?: boolean
        }
      }
      fn_verify_staff_pin: {
        Args: {
          _school_id: string
          _pin: string
          _device_info?: string | null
        }
        Returns: {
          success: boolean
          error?: string
          message?: string
          session_token?: string
          expires_at?: string
          must_change?: boolean
          locked_until?: string
          attempts_remaining?: number
        }
      }
      fn_validate_staff_session: {
        Args: { _session_token: string }
        Returns: {
          is_valid: boolean
          school_id?: string
          expires_at?: string
          must_change?: boolean
        }
      }
      fn_admin_set_account_active: {
        Args: {
          _target_user_id: string
          _is_active: boolean
          _reason?: string | null
          _school_id?: string | null
        }
        Returns: Json
      }
      fn_setup_tenant_user_domain: {
        Args: {
          _user_id: string
          _email: string
          _full_name: string
          _role: string
          _school_id?: string | null
          _caller_id: string
          _class_id?: string | null
          _guardian_id?: string | null
          _guardian_relationship?: string | null
          _is_primary_guardian?: boolean | null
          _combined_account?: boolean | null
          _employee_designation?: string | null
          _employee_department?: string | null
          _employee_name?: string | null
        }
        Returns: Json
      }
      fn_audit_duplicate_decision: {
        Args: {
          _school_id: string
          _resolution: string
          _candidate_id?: string | null
          _candidate_name?: string | null
          _match_reasons?: string[] | null
          _input_name?: string | null
          _input_email?: string | null
          _detail_notes?: string | null
        }
        Returns: Json
      }
      fn_revoke_staff_session: {
        Args: {
          _session_token: string
          _reason?: string
        }
        Returns: Json
      }
      fn_is_staff_unlocked: {
        Args: { _school_id: string; _session_token: string }
        Returns: boolean
      }
      fn_manual_unlock: {
        Args: { p_actor: string; p_school: string; p_until: string }
        Returns: undefined
      }
      fn_mark_class_attendance: {
        Args: { p_class: string; p_date: string; p_marks: Json }
        Returns: number
      }
      fn_mark_invoice_paid: {
        Args: { p_actor: string; p_invoice: string }
        Returns: undefined
      }
      fn_notify_school_admins: {
        Args: {
          p_action_url?: string
          p_message: string
          p_metadata?: Json
          p_school: string
          p_title: string
          p_type: string
        }
        Returns: undefined
      }
      fn_recompute_school_status: {
        Args: { p_school: string }
        Returns: Database["public"]["Enums"]["subscription_status_t"]
      }
      fn_record_fee_payment: {
        Args: {
          p_amount: number
          p_invoice: string
          p_method: string
          p_notes: string
          p_reference: string
        }
        Returns: string
      }
      fn_restore_school: {
        Args: { p_actor: string; p_school: string }
        Returns: undefined
      }
      get_auth_role: { Args: never; Returns: string }
      get_auth_school_id: { Args: never; Returns: string }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      refresh_dashboard_metrics: { Args: never; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      subscription_status_t: "active" | "payment_due" | "locked" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      subscription_status_t: ["active", "payment_due", "locked", "archived"],
    },
  },
} as const
