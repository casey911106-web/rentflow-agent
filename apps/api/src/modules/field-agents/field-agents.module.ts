import { Module } from '@nestjs/common';
import { FieldAgentsController } from './field-agents.controller';

@Module({ controllers: [FieldAgentsController] })
export class FieldAgentsModule {}
