export type RiskTier = 'low' | 'medium' | 'high';
export interface MonocultureRisk { tier: RiskTier; vendor: string | null; reason: string; }
export interface VoiceRisk { tier: RiskTier; score: number; flags: string[]; suggestions: string[]; }
export interface RoutingSuggestion { channel: 'portal' | 'referral' | 'hiring-manager' | 'smaller-company'; rationale: string; action: string; }
export interface DecorrelationInfo { score: number; similarTo: { jobId: number; company: string | null; similarity: number }[]; advice: string; }
export interface StrategyReport { jobId: number; monoculture: MonocultureRisk; routing: RoutingSuggestion[]; voice: VoiceRisk | null; decorrelation: DecorrelationInfo; summary: string; }
