package com.aioffice.workflow.dto;

import lombok.Data;
import java.util.Date;

@Data
public class WorkflowTaskDto {
    private String taskId;
    private String taskName;
    private String processInstanceId;
    private String businessKey;
    private String assignee;
    private String subject;
    private String sender;
    private String priority;
    private String category;
    private String aiSummary;
    private Date createTime;
}
