export interface InserveCompany {
  id: number;
  name: string;
  debtor_code?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  postal_code?: string | null;
  telephone?: string | null;
  email?: string | null;
  city?: string | null;
  country?: string | null;
  kvk_nr?: string | null;
  btw_nr?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface InserveArticle {
  id: number;
  name: string;
  code?: string | null;
  price_excl?: number | null;
  price_incl?: number | null;
  btw_percentage?: number | null;
  unit?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type InserveContractCycle = 'monthly' | 'quarterly' | 'yearly';

export interface InserveContract {
  id: number;
  company_id: number;
  article_id?: number | null;
  start_date: string;
  end_date?: string | null;
  price?: number | null;
  cycle?: InserveContractCycle | null;
  quantity?: number | null;
  reference?: string | null;
  description?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type CreateCompanyRequest = Partial<Omit<InserveCompany, 'id' | 'created_at' | 'updated_at'>> &
  Required<Pick<InserveCompany, 'name'>>;

export type UpdateCompanyRequest = Partial<Omit<InserveCompany, 'id' | 'created_at' | 'updated_at'>>;

export type CreateArticleRequest = Partial<Omit<InserveArticle, 'id' | 'created_at' | 'updated_at'>> &
  Required<Pick<InserveArticle, 'name'>>;

export type CreateContractRequest = Partial<Omit<InserveContract, 'id' | 'created_at' | 'updated_at'>> &
  Required<Pick<InserveContract, 'company_id' | 'start_date'>>;

export interface CancelContractRequest {
  status?: string;
  end_date?: string;
  reason?: string;
}

export interface InserveListResponse<T> {
  data: T[];
  meta?: {
    current_page?: number;
    last_page?: number;
    per_page?: number;
    total?: number;
  };
}
