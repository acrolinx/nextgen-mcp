#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import FormData from 'form-data';
import fetch, { File, Blob } from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Logging configuration
const DEBUG = process.env.DEBUG === 'true';
const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
type LogLevel = typeof LOG_LEVELS[number];

function log(level: LogLevel, message: string, data?: any) {
  if (level === 'debug' && !DEBUG) return;
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : '';
  console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}${logData}`);
}

// Validate required environment variables
const REQUIRED_ENV_VARS = ['MARKUPAI_API_KEY'];
const missingVars = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  log('error', 'Missing required environment variables', missingVars);
  console.error('\nPlease set the following environment variables:');
  missingVars.forEach(varName => console.error(`  - ${varName}`));
  console.error('\nYou can create a .env file with these variables.');
  process.exit(1);
}

// Configuration
const MARKUPAI_BASE_URL = process.env.MARKUPAI_BASE_URL || 'https://api.markup.ai';
const MARKUPAI_API_KEY = process.env.MARKUPAI_API_KEY!;
const WORKFLOW_TIMEOUT = parseInt(process.env.WORKFLOW_TIMEOUT || '60000', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '2000', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

log('info', 'Configuration loaded', {
  baseUrl: MARKUPAI_BASE_URL,
  workflowTimeout: WORKFLOW_TIMEOUT,
  pollInterval: POLL_INTERVAL,
  maxRetries: MAX_RETRIES
});

// Style guide name to UUID mapping
const STYLE_GUIDE_IDS: Record<string, string> = {
  'ap': '01971e03-dd27-75ee-9044-b48e654848cf',
  'chicago': '01971e03-dd27-77d8-a6fa-5edb6a1f4ad2',
  'microsoft': '01971e03-dd27-779f-b3ec-b724a2cf809f',
  'proofpoint': '01971e03-dd27-7dfa-8d96-d48c8cf5e4fe',
};

// Type definitions
interface BaseToolArgs {
  text: string;
  dialect?: string;
  tone?: string;
  style_guide?: string;
}

interface WorkflowStatusArgs {
  workflow_id: string;
  workflow_type: 'rewrites' | 'checks' | 'suggestions';
}

// Score component interfaces
interface GrammarScore {
  score: number | null;
  issues?: number;
}

interface StyleGuideScore {
  score: number | null;
  issues?: number;
}

interface TerminologyScore {
  score: number | null;
  issues?: number;
}

interface ClarityScore {
  score: number | null;
  word_count?: number;
  sentence_count?: number;
  average_sentence_length?: number;
  flesch_reading_ease?: number;
  flesch_kincaid_grade?: number;
}

interface ToneScore {
  score: number | null;
  informality?: number;
  target_informality?: number;
  liveliness?: number;
  target_liveliness?: number;
}

// Main score structure
interface QualityScore {
  score: number | null;
  grammar?: GrammarScore;
  style_guide?: StyleGuideScore;
  terminology?: TerminologyScore;
}

interface AnalysisScore {
  clarity?: ClarityScore;
  tone?: ToneScore;
}

interface ScoreOutput {
  quality?: QualityScore;
  analysis?: AnalysisScore;
}

// Issue/Suggestion interfaces
interface Issue {
  original: string;
  char_index?: number;
  category?: string;
  subcategory?: string;
}

interface Suggestion {
  original: string;
  suggestion?: string;
  modified?: string;
  char_index?: number;
  category?: string;
  subcategory?: string;
}

// Response interfaces
interface StyleCheckResponse {
  workflow_id?: string;
  status: 'running' | 'completed' | 'failed';
  scores?: ScoreOutput | null;
  issues?: Issue[];
  check_options?: any;
  webhook_response?: any;
  error?: string;
}

interface RewriteResponse {
  workflow_id?: string;
  status: 'running' | 'completed' | 'failed';
  scores?: ScoreOutput | null;
  rewrite_scores?: ScoreOutput | null;
  issues?: Suggestion[];
  rewrite?: string | null;
  check_options?: any;
  webhook_response?: any;
  error?: string;
}

interface SuggestionResponse {
  workflow_id?: string;
  status: 'running' | 'completed' | 'failed';
  scores?: ScoreOutput | null;
  issues?: Suggestion[];
  check_options?: any;
  webhook_response?: any;
  error?: string;
}

type WorkflowResponse = StyleCheckResponse | RewriteResponse | SuggestionResponse;

// Type guards
function isBaseToolArgs(args: unknown): args is BaseToolArgs {
  return (
    typeof args === 'object' &&
    args !== null &&
    'text' in args &&
    typeof (args as any).text === 'string'
  );
}

function isWorkflowStatusArgs(args: unknown): args is WorkflowStatusArgs {
  return (
    typeof args === 'object' &&
    args !== null &&
    'workflow_id' in args &&
    'workflow_type' in args &&
    typeof (args as any).workflow_id === 'string' &&
    ['rewrites', 'checks', 'suggestions'].includes((args as any).workflow_type)
  );
}

// Input validation
function validateTextInput(text: string): void {
  if (!text || text.trim().length === 0) {
    throw new Error('Text parameter is required and must be a non-empty string');
  }

  const MAX_TEXT_LENGTH = parseInt(process.env.MAX_TEXT_LENGTH || '100000', 10);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
  }
}

// Retry logic with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  operationName: string,
  maxRetries = MAX_RETRIES,
  baseDelay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      log('debug', `Attempting ${operationName} (attempt ${i + 1}/${maxRetries})`);
      const result = await fn();
      if (i > 0) {
        log('info', `${operationName} succeeded after ${i + 1} attempts`);
      }
      return result;
    } catch (error) {
      const isLastAttempt = i === maxRetries - 1;
      const delay = baseDelay * Math.pow(2, i);

      log('warn', `${operationName} failed (attempt ${i + 1}/${maxRetries})`, {
        error: error instanceof Error ? error.message : error,
        willRetry: !isLastAttempt,
        nextDelayMs: !isLastAttempt ? delay : undefined
      });

      if (isLastAttempt) {
        throw new Error(`${operationName} failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : error}`);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error(`${operationName}: Max retries exceeded`);
}

// Define available tools
const TOOLS: Tool[] = [
  {
    name: 'markupai_rewrite',
    description: 'Automatically rewrite and improve text content using AI-powered style guides. This tool analyzes your text for grammar, clarity, tone, and style guide compliance, then provides a completely rewritten version. Use this when you need to transform rough drafts into polished content, ensure consistency with brand voice, or adapt content for different audiences. Returns both before/after scores and the rewritten text.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text content to rewrite',
          minLength: 1,
        },
        dialect: {
          type: 'string',
          description: 'Language dialect',
          enum: ['american_english', 'british_oxford', 'canadian_english'],
          default: 'american_english'
        },
        tone: {
          type: 'string',
          description: 'Desired tone of the rewritten content',
          enum: ['academic', 'business', 'casual', 'conversational', 'formal', 'gen-z', 'informal', 'technical'],
          default: 'formal'
        },
        style_guide: {
          type: 'string',
          description: 'Style guide to follow (predefined: ap, chicago, microsoft, proofpoint) or custom UUID',
          default: 'microsoft'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'markupai_check',
    description: 'Analyze text for quality issues without making changes. This tool provides detailed scores for grammar, clarity, tone, style guide compliance, and terminology. Use this for content audits, quality assessments, or when you want to understand specific issues before editing. Returns comprehensive readability metrics and issue counts by category.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text content to analyze',
          minLength: 1,
        },
        dialect: {
          type: 'string',
          description: 'Language dialect',
          enum: ['american_english', 'british_oxford', 'canadian_english'],
          default: 'american_english'
        },
        tone: {
          type: 'string',
          description: 'Target tone to check against',
          enum: ['academic', 'business', 'casual', 'conversational', 'formal', 'gen-z', 'informal', 'technical'],
          default: 'formal'
        },
        style_guide: {
          type: 'string',
          description: 'Style guide to check against (predefined: ap, chicago, microsoft) or custom UUID',
          default: 'microsoft'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'markupai_suggestions',
    description: 'Get detailed editing suggestions for improving text. This tool identifies specific issues and provides targeted recommendations for each problem found. Use this when you want to maintain editorial control while getting guidance on improvements. Returns a categorized list of issues with specific suggestions for each.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text content to get suggestions for',
          minLength: 1,
        },
        dialect: {
          type: 'string',
          description: 'Language dialect',
          enum: ['american_english', 'british_oxford', 'canadian_english'],
          default: 'american_english'
        },
        tone: {
          type: 'string',
          description: 'Target tone for suggestions',
          enum: ['academic', 'business', 'casual', 'conversational', 'formal', 'gen-z', 'informal', 'technical'],
          default: 'formal'
        },
        style_guide: {
          type: 'string',
          description: 'Style guide for suggestions (predefined: ap, chicago, microsoft) or custom UUID',
          default: 'microsoft'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'markupai_workflow_status',
    description: 'Check the status of an asynchronous Markup.ai workflow. Use this to poll for results when other operations return a running status. Workflows typically complete within 5-30 seconds depending on text length and complexity.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The workflow ID to check status for'
        },
        workflow_type: {
          type: 'string',
          description: 'The type of workflow',
          enum: ['rewrites', 'checks', 'suggestions']
        }
      },
      required: ['workflow_id', 'workflow_type']
    }
  }
];

// Create a buffer for upload
function createTextBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf-8');
}

// Submit a workflow to Markup.ai
async function submitWorkflow(
  endpoint: 'rewrites' | 'checks' | 'suggestions',
  text: string,
  dialect: string,
  tone: string,
  style_guide: string
): Promise<StyleCheckResponse | RewriteResponse | SuggestionResponse> {
  validateTextInput(text);

  return retryWithBackoff(async () => {
    const formData = new FormData();
    const textBuffer = createTextBuffer(text);
    formData.append('file_upload', textBuffer, {
      filename: 'content.txt',
      contentType: 'text/plain'
    });
    formData.append('dialect', dialect);
    formData.append('tone', tone);

    // Convert style guide name to UUID
    const styleGuideId = STYLE_GUIDE_IDS[style_guide] || style_guide;
    formData.append('style_guide', styleGuideId);

    log('debug', `Submitting ${endpoint} workflow`, {
      dialect,
      tone,
      style_guide: styleGuideId,
      textLength: text.length
    });

    const response = await fetch(`${MARKUPAI_BASE_URL}/v1/style/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MARKUPAI_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log('error', `API request failed`, {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      throw new Error(`Markup.ai API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json() as StyleCheckResponse | RewriteResponse | SuggestionResponse;
    log('info', `Workflow submitted successfully`, {
      workflow_id: result.workflow_id,
      status: result.status
    });

    return result;
  }, `submit ${endpoint} workflow`);
}

// Get workflow status
async function getWorkflowStatus(
  workflow_id: string,
  workflow_type: 'rewrites' | 'checks' | 'suggestions'
): Promise<StyleCheckResponse | RewriteResponse | SuggestionResponse> {
  return retryWithBackoff(async () => {
    log('debug', `Checking workflow status`, { workflow_id, workflow_type });

    const response = await fetch(
      `${MARKUPAI_BASE_URL}/v1/style/${workflow_type}/${workflow_id}`,
      {
        headers: {
          'Authorization': `Bearer ${MARKUPAI_API_KEY}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      log('error', `Status check failed`, {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      throw new Error(`Markup.ai API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json() as StyleCheckResponse | RewriteResponse | SuggestionResponse;
    log('debug', `Workflow status retrieved`, {
      workflow_id,
      status: result.status
    });

    return result;
  }, 'check workflow status');
}

// Poll workflow until completion with timeout
async function pollWorkflowCompletion(
  workflow_id: string,
  workflow_type: 'rewrites' | 'checks' | 'suggestions',
  initialResult: StyleCheckResponse | RewriteResponse | SuggestionResponse
): Promise<StyleCheckResponse | RewriteResponse | SuggestionResponse> {
  const startTime = Date.now();
  let result = initialResult;
  let status = result.status;

  log('info', `Polling workflow for completion`, {
    workflow_id,
    workflow_type,
    timeout: WORKFLOW_TIMEOUT
  });

  while (status === 'running') {
    const elapsedTime = Date.now() - startTime;

    if (elapsedTime > WORKFLOW_TIMEOUT) {
      log('error', `Workflow timeout`, {
        workflow_id,
        elapsedTime,
        timeout: WORKFLOW_TIMEOUT
      });
      throw new Error(`Workflow timeout after ${WORKFLOW_TIMEOUT}ms. Workflow ID: ${workflow_id}`);
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

    try {
      result = await getWorkflowStatus(workflow_id, workflow_type);
      status = result.status;

      log('debug', `Workflow poll update`, {
        workflow_id,
        status,
        elapsedTime
      });
    } catch (error) {
      log('warn', `Error during polling, will retry`, {
        workflow_id,
        error: error instanceof Error ? error.message : error
      });
      // Continue polling even if individual status checks fail
    }
  }

  if (status === 'failed') {
    log('error', `Workflow failed`, {
      workflow_id,
      error: result.error
    });
    throw new Error(`Workflow failed: ${result.error || 'Unknown error'}`);
  }

  log('info', `Workflow completed successfully`, {
    workflow_id,
    totalTime: Date.now() - startTime
  });

  // Ensure the final result includes the workflow_id from the original submission
  if (!result.workflow_id) {
    result.workflow_id = workflow_id;
  }

  return result;
}

// Format response with highlighted scores
function formatResponse(result: StyleCheckResponse | RewriteResponse | SuggestionResponse): string {
  let formatted = `Status: ${result.status}\n`;
  if (result.workflow_id) {
    formatted += `Workflow ID: ${result.workflow_id}\n`;
  }

  // Format original scores
  if (result.scores) {
    formatted += '\n=== SCORES ===\n';
    
    // Quality scores
    if (result.scores.quality) {
      formatted += `Quality Score: ${result.scores.quality.score ?? 'N/A'}\n`;
      
      if (result.scores.quality.grammar) {
        formatted += `  Grammar: ${result.scores.quality.grammar.score ?? 'N/A'}`;
        if (result.scores.quality.grammar.issues !== undefined) {
          formatted += ` (${result.scores.quality.grammar.issues} issues)`;
        }
        formatted += '\n';
      }
      
      if (result.scores.quality.style_guide) {
        formatted += `  Style Guide: ${result.scores.quality.style_guide.score ?? 'N/A'}`;
        if (result.scores.quality.style_guide.issues !== undefined) {
          formatted += ` (${result.scores.quality.style_guide.issues} issues)`;
        }
        formatted += '\n';
      }
      
      if (result.scores.quality.terminology) {
        formatted += `  Terminology: ${result.scores.quality.terminology.score ?? 'N/A'}`;
        if (result.scores.quality.terminology.issues !== undefined) {
          formatted += ` (${result.scores.quality.terminology.issues} issues)`;
        }
        formatted += '\n';
      }
    }
    
    // Analysis scores
    if (result.scores.analysis) {
      if (result.scores.analysis.clarity) {
        const clarity = result.scores.analysis.clarity;
        formatted += `Clarity Score: ${clarity.score ?? 'N/A'}\n`;
        if (clarity.word_count !== undefined) {
          formatted += `  - Word Count: ${clarity.word_count}\n`;
        }
        if (clarity.sentence_count !== undefined) {
          formatted += `  - Sentence Count: ${clarity.sentence_count}\n`;
        }
        if (clarity.average_sentence_length !== undefined) {
          formatted += `  - Avg Sentence Length: ${clarity.average_sentence_length}\n`;
        }
        if (clarity.flesch_reading_ease !== undefined) {
          formatted += `  - Flesch Reading Ease: ${clarity.flesch_reading_ease}\n`;
        }
        if (clarity.flesch_kincaid_grade !== undefined) {
          formatted += `  - Flesch-Kincaid Grade: ${clarity.flesch_kincaid_grade}\n`;
        }
      }
      
      if (result.scores.analysis.tone) {
        const tone = result.scores.analysis.tone;
        formatted += `Tone Score: ${tone.score ?? 'N/A'}\n`;
        if (tone.informality !== undefined && tone.target_informality !== undefined) {
          formatted += `  - Informality: ${tone.informality} (target: ${tone.target_informality})\n`;
        }
        if (tone.liveliness !== undefined && tone.target_liveliness !== undefined) {
          formatted += `  - Liveliness: ${tone.liveliness} (target: ${tone.target_liveliness})\n`;
        }
      }
    }
  }

  // Format rewrite scores (for RewriteResponse)
  if ('rewrite_scores' in result && result.rewrite_scores) {
    formatted += '\n=== REWRITE SCORES ===\n';
    
    // Quality scores
    if (result.rewrite_scores.quality) {
      formatted += `Quality Score: ${result.rewrite_scores.quality.score ?? 'N/A'}\n`;
      
      if (result.rewrite_scores.quality.grammar) {
        formatted += `  Grammar: ${result.rewrite_scores.quality.grammar.score ?? 'N/A'}`;
        if (result.rewrite_scores.quality.grammar.issues !== undefined) {
          formatted += ` (${result.rewrite_scores.quality.grammar.issues} issues)`;
        }
        formatted += '\n';
      }
      
      if (result.rewrite_scores.quality.style_guide) {
        formatted += `  Style Guide: ${result.rewrite_scores.quality.style_guide.score ?? 'N/A'}`;
        if (result.rewrite_scores.quality.style_guide.issues !== undefined) {
          formatted += ` (${result.rewrite_scores.quality.style_guide.issues} issues)`;
        }
        formatted += '\n';
      }
      
      if (result.rewrite_scores.quality.terminology) {
        formatted += `  Terminology: ${result.rewrite_scores.quality.terminology.score ?? 'N/A'}`;
        if (result.rewrite_scores.quality.terminology.issues !== undefined) {
          formatted += ` (${result.rewrite_scores.quality.terminology.issues} issues)`;
        }
        formatted += '\n';
      }
    }
    
    // Analysis scores
    if (result.rewrite_scores.analysis) {
      if (result.rewrite_scores.analysis.clarity) {
        formatted += `Clarity Score: ${result.rewrite_scores.analysis.clarity.score ?? 'N/A'}\n`;
      }
      if (result.rewrite_scores.analysis.tone) {
        formatted += `Tone Score: ${result.rewrite_scores.analysis.tone.score ?? 'N/A'}\n`;
      }
    }
  }

  // Format rewritten text (for RewriteResponse)
  if ('rewrite' in result && result.rewrite) {
    formatted += '\n=== REWRITTEN TEXT ===\n';
    formatted += result.rewrite + '\n';
  }

  // Format issues/suggestions
  if (result.issues && result.issues.length > 0) {
    formatted += `\n=== ISSUES (${result.issues.length} total) ===\n`;
    result.issues.forEach((issue, idx) => {
      const suggestion = 'suggestion' in issue ? issue.suggestion : undefined;
      const modified = 'modified' in issue ? issue.modified : undefined;
      formatted += `${idx + 1}. [${issue.category || issue.subcategory || 'N/A'}] ${issue.original} → ${suggestion || modified || 'N/A'}\n`;
    });
  }

  if (DEBUG) {
    formatted += '\n=== FULL RESPONSE ===\n';
    formatted += JSON.stringify(result, null, 2);
  }

  return formatted;
}

// Graceful shutdown handler
async function gracefulShutdown(server: Server) {
  log('info', 'Received shutdown signal, closing server gracefully...');
  try {
    await server.close();
    log('info', 'Server closed successfully');
    process.exit(0);
  } catch (error) {
    log('error', 'Error during shutdown', error);
    process.exit(1);
  }
}

// Main server
async function main() {
  const server = new Server(
    {
      name: 'markupai-mcp-server',
      vendor: 'markupai',
      version: '1.0.0',
      description: 'MCP server for Markup.ai API text analysis and improvement'
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register shutdown handlers
  process.on('SIGTERM', () => gracefulShutdown(server));
  process.on('SIGINT', () => gracefulShutdown(server));

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOLS,
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'markupai_rewrite': {
          if (!isBaseToolArgs(args)) {
            throw new Error('Invalid arguments for markupai_rewrite');
          }

          const { text, dialect = 'american_english', tone = 'formal', style_guide = 'microsoft' } = args;

          log('info', `Starting rewrite operation`, {
            textLength: text.length,
            dialect,
            tone,
            style_guide
          });

          // Submit rewrite request
          const submitResult = await submitWorkflow('rewrites', text, dialect, tone, style_guide);

          // Poll for completion if workflow is running, otherwise use the immediate result
          const result = submitResult.status === 'running' && submitResult.workflow_id
            ? await pollWorkflowCompletion(submitResult.workflow_id, 'rewrites', submitResult)
            : submitResult;

          return {
            content: [
              {
                type: 'text',
                text: formatResponse(result)
              }
            ]
          };
        }

        case 'markupai_check': {
          if (!isBaseToolArgs(args)) {
            throw new Error('Invalid arguments for markupai_check');
          }

          const { text, dialect = 'american_english', tone = 'formal', style_guide = 'microsoft' } = args;

          log('info', `Starting check operation`, {
            textLength: text.length,
            dialect,
            tone,
            style_guide
          });

          // Submit check request
          const submitResult = await submitWorkflow('checks', text, dialect, tone, style_guide);

          // Poll for completion if workflow is running, otherwise use the immediate result
          const result = submitResult.status === 'running' && submitResult.workflow_id
            ? await pollWorkflowCompletion(submitResult.workflow_id, 'checks', submitResult)
            : submitResult;

          return {
            content: [
              {
                type: 'text',
                text: formatResponse(result)
              }
            ]
          };
        }

        case 'markupai_suggestions': {
          if (!isBaseToolArgs(args)) {
            throw new Error('Invalid arguments for markupai_suggestions');
          }

          const { text, dialect = 'american_english', tone = 'formal', style_guide = 'microsoft' } = args;

          log('info', `Starting suggestions operation`, {
            textLength: text.length,
            dialect,
            tone,
            style_guide
          });

          // Submit suggestions request
          const submitResult = await submitWorkflow('suggestions', text, dialect, tone, style_guide);

          // Poll for completion if workflow is running, otherwise use the immediate result
          const result = submitResult.status === 'running' && submitResult.workflow_id
            ? await pollWorkflowCompletion(submitResult.workflow_id, 'suggestions', submitResult)
            : submitResult;

          return {
            content: [
              {
                type: 'text',
                text: formatResponse(result)
              }
            ]
          };
        }

        case 'markupai_workflow_status': {
          if (!isWorkflowStatusArgs(args)) {
            throw new Error('Invalid arguments for markupai_workflow_status');
          }

          const { workflow_id, workflow_type } = args;

          log('info', `Checking workflow status`, {
            workflow_id,
            workflow_type
          });

          const result = await getWorkflowStatus(workflow_id, workflow_type);

          return {
            content: [
              {
                type: 'text',
                text: formatResponse(result)
              }
            ]
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `Tool execution failed`, {
        tool: name,
        error: errorMessage
      });

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('info', 'Markup.ai MCP server running on stdio');
}

main().catch((error) => {
  log('error', 'Server startup failed', error);
  console.error('Fatal error:', error);
  process.exit(1);
});
