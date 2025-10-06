import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openai = new OpenAI({ apiKey });
  }

  async generateTaskSuggestions(context?: string) {
    try {
      const prompt = context
        ? `Generate 5 task suggestions based on this context: ${context}. 
           Return ONLY a JSON array of objects with 'title' and 'description' fields. 
           Example: [{"title": "Task 1", "description": "Description 1"}]`
        : `Generate 5 productive daily task suggestions for a professional. 
           Return ONLY a JSON array of objects with 'title' and 'description' fields.
           Example: [{"title": "Task 1", "description": "Description 1"}]`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful productivity assistant. Generate practical and actionable task suggestions. Always respond with valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const content = completion.choices[0].message.content;
      
      let suggestions;
      try {
        suggestions = JSON.parse(content);
      } catch (parseError) {
        suggestions = [
          {
            title: 'Review daily goals',
            description: 'Take 10 minutes to review and prioritize your daily objectives',
          },
          {
            title: 'Check emails',
            description: 'Process inbox and respond to urgent messages',
          },
          {
            title: 'Team sync',
            description: 'Prepare for team meeting and update task status',
          },
          {
            title: 'Deep work session',
            description: 'Block 2 hours for focused work on priority project',
          },
          {
            title: 'End of day review',
            description: 'Review completed tasks and plan for tomorrow',
          },
        ];
      }

      return {
        suggestions: Array.isArray(suggestions) ? suggestions : [suggestions],
      };
    } catch (error) {
      console.error('OpenAI API Error:', error);
      
      // Fallback suggestions if API fails
      return {
        suggestions: [
          {
            title: 'Morning planning',
            description: 'Review your calendar and set priorities for the day',
          },
          {
            title: 'Important project work',
            description: 'Allocate focused time for your most important project',
          },
          {
            title: 'Communication check',
            description: 'Respond to pending messages and emails',
          },
          {
            title: 'Learning time',
            description: 'Spend 30 minutes on professional development',
          },
          {
            title: 'Daily reflection',
            description: 'Review what you accomplished and plan for tomorrow',
          },
        ],
      };
    }
  }
}