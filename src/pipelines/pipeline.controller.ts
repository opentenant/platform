import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Session,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { withSupabase, SupabaseCtx } from '@supabase/server/adapters/nestjs';
import { supabaseEnv, config as appConfig } from '../config';
import { CreatePipelineDTO, PipelineConfig, UpdatePipelineDTO } from '../types';
import { PipelineService } from './pipeline.service';
import { getGitAdapter } from 'git-adapter';
import type { Platform } from 'git-adapter';
import { githubOAuthClient } from '../git/github-auth';
import { gitlabOAuthClient } from '../git/gitlab-auth';

@Controller('git')
@UseGuards(withSupabase({ auth: 'user', env: supabaseEnv }))
@ApiBearerAuth('user')
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Get('login/:provider/init')
  @ApiParam({ name: 'provider', enum: ['github', 'gitlab'] })
  async initGitLogin(
    @Param('provider') provider: 'github' | 'gitlab',
    @Query('projectId') projectId: string,
    @Session() session: Record<string, any>,
    @SupabaseCtx('userClaims') user,
  ) {
    if (!user?.id) {
      throw new UnauthorizedException('supabase_user_required');
    }

    // Store projectId in session for redirect after OAuth
    session.projectRedirect = projectId;

    let redirectUri: string;
    if (provider === 'github') {
      redirectUri = githubOAuthClient.code.getUri() + '&allow_signup=true';
    } else {
      redirectUri = gitlabOAuthClient.code.getUri();
    }
    return { redirectUri };
  }

  // ---- whoami ----
  @Get('whoami')
  async whoami(
    @Query('provider') provider: Platform,
    @SupabaseCtx('userClaims') user,
  ) {
    return this.pipelineService.whoami(user!.id, provider);
  }

  // ---- list repos ----
  @Get(':platform/repos')
  @ApiParam({ name: 'platform', enum: ['github', 'gitlab'] })
  async listRepos(
    @Param('platform') platform: Platform,
    @SupabaseCtx('userClaims') user,
  ) {
    const session = await this.pipelineService.getSessionForUser(
      user!.id,
      platform,
    );

    const adapter = getGitAdapter(platform, {
      customGitlab: {
        apiUrl: appConfig.customGitlabHost,
        agentUser: appConfig.customGitlabAgentUser,
      },
      github: { agentUser: appConfig.githubAgentUser },
      gitlab: { agentUser: appConfig.gitlabComAgentUser },
    });
    return adapter.listRepos(session.accessToken, { page: 0, perPage: 100 });
  }

  // ---- browse directory contents ----
  @Get(':platform/repos/:repo/contents/*')
  @ApiParam({ name: 'platform', enum: ['github', 'gitlab'] })
  @ApiParam({ name: 'repo' })
  async contents(
    @Param('platform') platform: Platform,
    @Param('repo') repo: string,
    @Param('0') starPath: string,
    @Query('ref') ref: string,
    @SupabaseCtx('userClaims') user,
  ) {
    const decodedRepo = decodeURIComponent(repo);
    const path = starPath || '';
    return this.pipelineService.getContents(
      user!.id,
      platform,
      decodedRepo,
      path,
      ref || 'main',
    );
  }

  @Post('pipeline')
  async attachPipeline(
    @Body() body: CreatePipelineDTO,
    @SupabaseCtx('userClaims') user,
  ): Promise<PipelineConfig> {
    return this.pipelineService.attachPipeline(user!.id, body);
  }

  @Post('repo')
  async createRepo(
    @Body() body: CreatePipelineDTO,
    @SupabaseCtx('userClaims') user,
  ): Promise<PipelineConfig> {
    return this.pipelineService.createRepo(user!.id, body);
  }

  @Get('pipeline/:projectId')
  @ApiParam({ name: 'projectId' })
  async getPipeline(
    @Param('projectId') projectId: string,
    @SupabaseCtx('userClaims') user,
  ) {
    return this.pipelineService.getPipeline(user!.id, projectId);
  }

  @Put('pipeline/:projectId')
  @ApiParam({ name: 'projectId' })
  async updatePipeline(
    @Param('projectId') projectId: string,
    @Body() body: UpdatePipelineDTO,
    @SupabaseCtx('userClaims') user,
  ) {
    return this.pipelineService.updatePipeline(user!.id, projectId, body);
  }

  @Delete('pipeline/:projectId')
  @ApiParam({ name: 'projectId' })
  async detachPipeline(
    @Param('projectId') projectId: string,
    @SupabaseCtx('userClaims') user,
  ) {
    return this.pipelineService.detachPipeline(user!.id, projectId);
  }

  @Get('pipelines')
  async listPipelines(@SupabaseCtx('userClaims') user) {
    return this.pipelineService.listPipelinesForUser(user!.id);
  }
}
