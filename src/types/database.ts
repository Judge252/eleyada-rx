// Generated from the applied SQL migrations using @supabase/typegen. Do not edit.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      app_users: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          pharmacy_id: string | null;
          role: Database["public"]["Enums"]["app_role"];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id: string;
          is_active?: boolean;
          pharmacy_id?: string | null;
          role: Database["public"]["Enums"]["app_role"];
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          pharmacy_id?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
        };
        Relationships: [
          {
            foreignKeyName: "app_users_pharmacy_id_fkey";
            columns: ["pharmacy_id"];
            isOneToOne: false;
            referencedRelation: "pharmacies";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_events: {
        Row: {
          actor_user_id: string | null;
          entity_id: string;
          entity_type: string;
          event_type: string;
          id: string;
          metadata: NonNullable<Json>;
          occurred_at: string;
        };
        ComputedFields: never;
        Insert: {
          actor_user_id?: string | null;
          entity_id: string;
          entity_type: string;
          event_type: string;
          id?: string;
          metadata?: NonNullable<Json>;
          occurred_at?: string;
        };
        Update: {
          actor_user_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          event_type?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          occurred_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_user_id_fkey";
            columns: ["actor_user_id"];
            isOneToOne: false;
            referencedRelation: "app_users";
            referencedColumns: ["id"];
          },
        ];
      };
      clinic_entitlements: {
        Row: {
          clinic_id: string;
          ends_at: string | null;
          is_active: boolean;
          starts_at: string;
        };
        ComputedFields: never;
        Insert: {
          clinic_id: string;
          ends_at?: string | null;
          is_active?: boolean;
          starts_at?: string;
        };
        Update: {
          clinic_id?: string;
          ends_at?: string | null;
          is_active?: boolean;
          starts_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clinic_entitlements_clinic_id_fkey";
            columns: ["clinic_id"];
            isOneToOne: true;
            referencedRelation: "clinics";
            referencedColumns: ["id"];
          },
        ];
      };
      clinic_memberships: {
        Row: {
          clinic_id: string;
          is_active: boolean;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          clinic_id: string;
          is_active?: boolean;
          user_id: string;
        };
        Update: {
          clinic_id?: string;
          is_active?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clinic_memberships_clinic_id_fkey";
            columns: ["clinic_id"];
            isOneToOne: false;
            referencedRelation: "clinics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clinic_memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "prescribers";
            referencedColumns: ["user_id"];
          },
        ];
      };
      clinics: {
        Row: {
          id: string;
          is_active: boolean;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          is_active?: boolean;
          name: string;
        };
        Update: {
          id?: string;
          is_active?: boolean;
          name?: string;
        };
        Relationships: [];
      };
      dispensations: {
        Row: {
          access_method: string;
          dispensed_at: string;
          id: string;
          pharmacist_user_id: string | null;
          pharmacy_id: string | null;
          pharmacy_label: string | null;
          prescription_id: string;
        };
        ComputedFields: never;
        Insert: {
          access_method?: string;
          dispensed_at?: string;
          id?: string;
          pharmacist_user_id?: string | null;
          pharmacy_id?: string | null;
          pharmacy_label?: string | null;
          prescription_id: string;
        };
        Update: {
          access_method?: string;
          dispensed_at?: string;
          id?: string;
          pharmacist_user_id?: string | null;
          pharmacy_id?: string | null;
          pharmacy_label?: string | null;
          prescription_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dispensations_pharmacist_membership";
            columns: ["pharmacist_user_id", "pharmacy_id"];
            isOneToOne: false;
            referencedRelation: "app_users";
            referencedColumns: ["id", "pharmacy_id"];
          },
          {
            foreignKeyName: "dispensations_pharmacy_id_fkey";
            columns: ["pharmacy_id"];
            isOneToOne: false;
            referencedRelation: "pharmacies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dispensations_prescription_id_fkey";
            columns: ["prescription_id"];
            isOneToOne: true;
            referencedRelation: "prescriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      patients: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          patient_identifier: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          patient_identifier?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          patient_identifier?: string | null;
        };
        Relationships: [];
      };
      pharmacies: {
        Row: {
          contact_info: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          contact_info?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
        };
        Update: {
          contact_info?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
        };
        Relationships: [];
      };
      prescribers: {
        Row: {
          approved: boolean;
          display_name: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          approved?: boolean;
          display_name: string;
          user_id: string;
        };
        Update: {
          approved?: boolean;
          display_name?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prescribers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "app_users";
            referencedColumns: ["id"];
          },
        ];
      };
      prescription_items: {
        Row: {
          dose: string;
          duration: string;
          frequency: string;
          id: string;
          medication_name: string;
          prescription_id: string;
          quantity: number;
          sort_order: number;
          special_instructions: string | null;
          strength: string;
        };
        ComputedFields: never;
        Insert: {
          dose: string;
          duration: string;
          frequency: string;
          id?: string;
          medication_name: string;
          prescription_id: string;
          quantity: number;
          sort_order?: number;
          special_instructions?: string | null;
          strength: string;
        };
        Update: {
          dose?: string;
          duration?: string;
          frequency?: string;
          id?: string;
          medication_name?: string;
          prescription_id?: string;
          quantity?: number;
          sort_order?: number;
          special_instructions?: string | null;
          strength?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prescription_items_prescription_id_fkey";
            columns: ["prescription_id"];
            isOneToOne: false;
            referencedRelation: "prescriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      prescriptions: {
        Row: {
          created_at: string;
          doctor_notes: string | null;
          doctor_user_id: string;
          draft_request_id: string | null;
          expires_at: string | null;
          id: string;
          issued_at: string | null;
          patient_id: string;
          reference_digest: string | null;
          status: Database["public"]["Enums"]["prescription_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          doctor_notes?: string | null;
          doctor_user_id: string;
          draft_request_id?: string | null;
          expires_at?: string | null;
          id?: string;
          issued_at?: string | null;
          patient_id: string;
          reference_digest?: string | null;
          status?: Database["public"]["Enums"]["prescription_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          doctor_notes?: string | null;
          doctor_user_id?: string;
          draft_request_id?: string | null;
          expires_at?: string | null;
          id?: string;
          issued_at?: string | null;
          patient_id?: string;
          reference_digest?: string | null;
          status?: Database["public"]["Enums"]["prescription_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prescriptions_doctor_user_id_fkey";
            columns: ["doctor_user_id"];
            isOneToOne: false;
            referencedRelation: "app_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prescriptions_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      cancel_doctor_prescription: {
        Args: {
          p_expected_updated_at: string;
          p_id: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      consume_login_attempt: {
        Args: { p_client?: string; p_username: string };
        Returns: boolean;
      };
      delete_doctor_draft: {
        Args: { p_expected_updated_at: string; p_id: string };
        Returns: boolean;
      };
      dispense_pharmacy_prescription: {
        Args: {
          p_full_confirmed: boolean;
          p_identity_confirmed: boolean;
          p_lookup_id: string;
          p_prescription_id: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      get_doctor_issue_review: { Args: { p_id: string }; Returns: Json };
      get_doctor_lifecycle: { Args: { p_id: string }; Returns: Json };
      get_prescriber_context: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      has_active_session: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      issue_doctor_prescription: {
        Args: {
          p_expected_updated_at: string;
          p_id: string;
          p_request_id: string;
          p_review_fingerprint: string;
        };
        Returns: Json;
      };
      issue_form_prescription: {
        Args: { p_confirmed: boolean; p_payload: Json; p_request_id: string };
        Returns: Json;
      };
      lookup_pharmacy_prescription: {
        Args: { p_reference: string };
        Returns: Json;
      };
      public_dispense_prescription: {
        Args: {
          p_full_confirmed: boolean;
          p_identity_confirmed: boolean;
          p_lookup_id: string;
          p_pharmacy_label?: string;
          p_prescription_id: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      public_lookup_prescription: {
        Args: { p_client?: string; p_code: string; p_identifier: string };
        Returns: Json;
      };
      public_recover_dispensing: {
        Args: { p_lookup_id: string; p_request_id: string };
        Returns: Json;
      };
      recover_dispensing_receipt: {
        Args: { p_request_id: string };
        Returns: Json;
      };
      recover_form_receipt: { Args: { p_request_id: string }; Returns: Json };
      request_prescriber_access: {
        Args: {
          p_clinic?: string;
          p_email: string;
          p_name?: string;
          p_operation: string;
        };
        Returns: boolean;
      };
      reveal_doctor_reference: { Args: { p_id: string }; Returns: Json };
      save_doctor_draft: {
        Args: {
          p_doctor_notes: string;
          p_expected_updated_at?: string;
          p_items: Json;
          p_patient: Json;
          p_prescription_id?: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      search_pharmacy_identity: {
        Args: {
          p_country: string;
          p_identifier: string;
          p_offset?: number;
          p_type: string;
        };
        Returns: Json;
      };
      select_pharmacy_prescription: {
        Args: { p_prescription_id: string; p_search_id: string };
        Returns: Json;
      };
    };
    Enums: {
      app_role: "doctor" | "pharmacist";
      prescription_status: "draft" | "issued" | "cancelled" | "expired";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["doctor", "pharmacist"],
      prescription_status: ["draft", "issued", "cancelled", "expired"],
    },
  },
} as const;
