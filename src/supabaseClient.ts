import { createClient } from '@supabase/supabase-js';

// Estas llaves son públicas por diseño: la seguridad real la dan las políticas
// RLS (Row Level Security) que ya están activas en cada tabla de Supabase.
const supabaseUrl = 'https://hzatdfrjcqiimgqxcwwh.supabase.co';
const supabaseKey = 'sb_publishable_M7Sw70peDBPoyhTri7abdg_ksB9gCMY';

export const supabase = createClient(supabaseUrl, supabaseKey);
