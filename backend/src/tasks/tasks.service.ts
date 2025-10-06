import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateTaskDto, UpdateTaskDto, TaskStatus } from './dto/task.dto';
import { EmailService } from '../email/email.service';
import { SupabaseService } from '../supabase';

@Injectable()
export class TasksService {
  constructor(
    private supabaseService: SupabaseService,
    private emailService: EmailService,
  ) {}

  async create(userId: string, createTaskDto: CreateTaskDto, userEmail: string) {
    const supabase = this.supabaseService.getAdminClient();

    const taskData = {
      user_id: userId,
      title: createTaskDto.title,
      description: createTaskDto.description || '',
      status: createTaskDto.status || TaskStatus.TODO,
      due_date: createTaskDto.dueDate || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('tasks')
      .insert(taskData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create task: ${error.message}`);
    }

    // Send email notification (non-blocking)
    this.emailService
      .sendTaskCreatedNotification(userEmail, data.title, data.description)
      .catch((err) => {
        console.error('Failed to send task created email:', err?.message || err);
      });

    return data;
  }

  async findAll(userId: string) {
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch tasks: ${error.message}`);
    }

    return data;
  }

  async findOne(userId: string, taskId: string) {
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Task not found');
    }

    return data;
  }

  async update(userId: string, taskId: string, updateTaskDto: UpdateTaskDto) {
    const supabase = this.supabaseService.getAdminClient();

    await this.findOne(userId, taskId);

    const updateData: any = {
      title: updateTaskDto.title,
      description: updateTaskDto.description,
      status: updateTaskDto.status,
      due_date:
        typeof updateTaskDto.dueDate !== 'undefined'
          ? updateTaskDto.dueDate
          : undefined,
      updated_at: new Date().toISOString(),
    };
    Object.keys(updateData).forEach((k) => {
      if (updateData[k] === undefined) {
        delete updateData[k];
      }
    });

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update task: ${error.message}`);
    }

    return data;
  }

  async remove(userId: string, taskId: string) {
    const supabase = this.supabaseService.getAdminClient();

    // Verify task exists and belongs to user
    await this.findOne(userId, taskId);

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to delete task: ${error.message}`);
    }

    return { message: 'Task deleted successfully' };
  }

  // For cron job - get tasks summary
  async getTasksSummary(userId: string) {
    const supabase = this.supabaseService.getAdminClient();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: allTasks, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to fetch tasks: ${error.message}`);
    }

    const newTasks = allTasks.filter(
      (task) => new Date(task.created_at) >= today,
    );
    const completedTasks = allTasks.filter(
      (task) => task.status === TaskStatus.DONE,
    );
    const overdueTasks = allTasks.filter(
      (task) =>
        task.due_date &&
        new Date(task.due_date) < today &&
        task.status !== TaskStatus.DONE,
    );

    return {
      newTasks,
      completedTasks,
      overdueTasks,
    };
  }
}