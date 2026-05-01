---
name: novu-ec2-provision
description: Provision the EC2 host for the Track B Novu CE pilot in ap-south-1. Use when the user says "provision the EC2 host", "create the pilot instance", "spin up novu host", "launch the EC2 for novu", or describes setting up the AWS instance before deployment.
---

# Provision EC2 host for Novu CE pilot (Track B)

This is **step 1 of 6** in the Track B pilot deployment lifecycle:
1. **provision** ← (you are here)
2. bootstrap the OS
3. deploy the CE stack
4. configure providers
5. sync Bridge workflows
6. run smoke tests

## Pre-flight (confirm before provisioning)

- [ ] AWS account + IAM permissions to create EC2, EBS, KMS, Security Groups, IAM roles, Route 53.
- [ ] Hosted zone for the pilot domain (e.g. `novu-pilot.internal.example.com`) exists.
- [ ] Bastion or AWS Systems Manager Session Manager already configured. **Direct SSH from public internet is not acceptable** (Charter §4 hardening rule).
- [ ] KMS CMK created for EBS encryption (record the key ARN).
- [ ] Provider credentials gathered ahead: SES verified identity, MSG91 / Gupshup auth key, FCM service-account JSON.
- [ ] `JWT_SECRET`, `STORE_ENCRYPTION_KEY` (exactly 32 chars), and `NOVU_SECRET_KEY` will be generated on the host by `bootstrap.sh`. **Do not pre-create them**.

## Instance launch parameters (deployment guide §4.2)

| Parameter | Value |
|---|---|
| Region | `ap-south-1` (Mumbai) |
| AMI | Amazon Linux 2023 (latest x86_64) |
| Instance type | `t3.xlarge` (4 vCPU, 16 GiB) |
| Storage | 100 GiB gp3, encrypted with project KMS CMK, **deletion-on-termination = disabled** |
| IAM instance profile | minimum: read specific Secrets Manager ARNs, write to specific S3 bucket, write CloudWatch Logs |
| Tags | `Environment=pilot, Owner=<team>, CostCentre=<code>, DataClassification=internal` |

## Security Group `novu-pilot-sg` rules

| Direction | Protocol/Port | Source/Dest | Why |
|---|---|---|---|
| inbound | tcp/443 | ALB SG only | Public TLS arrives via the ALB, not direct |
| inbound | tcp/22 | bastion SG only | SSH only via bastion / SSM |
| outbound | tcp/443 | `0.0.0.0/0` | Provider APIs + ECR + Docker Hub |

If you skip the ALB and let Caddy front directly (acceptable for a true single-EC2 pilot), open `tcp/80` and `tcp/443` from `0.0.0.0/0` — but the deployment guide records this as a pilot-only allowance, not for prod.

## Recommended bash recipe (run from your laptop with `aws` CLI)

```bash
# Substitute these
KMS_KEY_ARN="arn:aws:kms:ap-south-1:<acct>:key/<id>"
KEY_PAIR_NAME="novu-pilot"           # must already exist in the region
SUBNET_ID="subnet-xxxxxxxx"           # private app subnet, NAT-attached
BASTION_SG="sg-xxxxxxxx"              # bastion host SG
ALB_SG="sg-yyyyyyyy"                  # ALB SG fronting Novu (optional)
INSTANCE_PROFILE="novu-pilot-instance-profile"

# Latest AL2023 AMI
AMI_ID=$(aws ssm get-parameter \
  --region ap-south-1 \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameter.Value' --output text)

aws ec2 run-instances \
  --region ap-south-1 \
  --image-id "$AMI_ID" \
  --instance-type t3.xlarge \
  --key-name "$KEY_PAIR_NAME" \
  --subnet-id "$SUBNET_ID" \
  --iam-instance-profile Name="$INSTANCE_PROFILE" \
  --block-device-mappings '[{
    "DeviceName": "/dev/xvda",
    "Ebs": { "VolumeSize": 100, "VolumeType": "gp3",
             "Encrypted": true, "KmsKeyId": "'"$KMS_KEY_ARN"'",
             "DeleteOnTermination": false }
  }]' \
  --tag-specifications 'ResourceType=instance,Tags=[
    {Key=Name,Value=novu-pilot},
    {Key=Environment,Value=pilot},
    {Key=Project,Value=novu-notifications},
    {Key=DataClassification,Value=internal}]' \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=2
```

`HttpTokens=required` enables IMDSv2-only — required for the security baseline.

## Verify after launch

```bash
# Connect via SSM (no public SSH needed)
aws ssm start-session --region ap-south-1 --target i-xxxxxxxxxxx

# Inside the instance:
curl -I https://github.com   # outbound 443 reachable
df -h /                      # confirm 100 GiB gp3 attached
```

## Output before handing off

Record these for the next skill (`novu-ec2-bootstrap`):
- Instance ID
- Private IP
- Public DNS (if applicable)
- IAM instance profile name
- Security group ID
- KMS key ARN used for the EBS volume

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `UnauthorizedOperation` from `run-instances` | Missing `iam:PassRole` for the instance profile | Add the policy to the calling principal |
| Instance launches but SSM can't connect | Missing `AmazonSSMManagedInstanceCore` on the instance role | Attach it; reboot the instance |
| EBS volume encrypted with the wrong key | KMS key passed via root mapping but EBS default still active | Pass `KmsKeyId` explicitly in the block-device-mapping |
| AL2023 dnf can't reach repos | Subnet has no NAT or VPC endpoint for `com.amazonaws.<region>.s3` | Either attach NAT or add the S3 gateway endpoint |

## Next step

Once the instance is reachable via SSM, invoke the **`novu-ec2-bootstrap`** skill to install Docker, harden SSH, configure swap, and prepare `/opt/novu`.
