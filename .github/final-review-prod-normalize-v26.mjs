import { readFileSync,writeFileSync } from 'node:fs';
const path='infrastructure/terraform/environments/production/main.tf';
let value=readFileSync(path,'utf8');
const before=`variable "report_retention_days" {\n  type    = number\n  default = 365\n}\n`;
const after=`variable "report_retention_days" {\n  type    = number\n  default = null\n}\n`;
if(!value.includes(before))throw new Error('Production report_retention_days legacy block was not in the expected pre-retirement shape');
value=value.replace(before,after);
writeFileSync(path,value);
