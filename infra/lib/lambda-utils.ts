import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as fs from 'fs';
import {execFileSync} from 'child_process';
import {Construct} from 'constructs';

export interface PythonFunctionOptions {
    dirName: string;
    handler: string;
    functionName: string;
    environment?: {[key: string]: string};
    timeout?: cdk.Duration;
    memorySize?: number;
}

/**
 * Local bundling fallback: every Lambda here depends only on pure-Python
 * packages (boto3, icalendar, tzdata, and their dependencies) with no compiled
 * extensions, so a local `pip install` produces an artifact identical to the
 * Docker-bundled one regardless of host OS/architecture. Tried first so
 * `cdk synth`/`cdk deploy` work without Docker; CDK falls back to the Docker
 * `command` below (matching the template's original bundling convention)
 * automatically if this returns false.
 */
function localBundlingFor(codePath: string): cdk.ILocalBundling {
    return {
        tryBundle(outputDir: string): boolean {
            try {
                execFileSync('pip3', ['install', '-q', '-r', 'requirements.txt', '-t', outputDir], {
                    cwd: codePath,
                    stdio: 'inherit',
                });
                fs.cpSync(codePath, outputDir, {
                    recursive: true,
                    filter: (src) => !src.includes('__pycache__'),
                });
                return true;
            } catch {
                return false;
            }
        },
    };
}

/**
 * One directory per function under backend/lambda/, pip install -r requirements.txt at synth/deploy time.
 */
export function pythonFunction(scope: Construct, id: string, options: PythonFunctionOptions): lambda.Function {
    const codePath = path.join(__dirname, `../../backend/lambda/${options.dirName}`);
    return new lambda.Function(scope, id, {
        runtime: lambda.Runtime.PYTHON_3_13,
        architecture: lambda.Architecture.ARM_64,
        handler: options.handler,
        code: lambda.Code.fromAsset(codePath, {
            bundling: {
                image: lambda.Runtime.PYTHON_3_13.bundlingImage,
                platform: 'linux/arm64',
                command: [
                    'bash', '-c',
                    'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output',
                ],
                local: localBundlingFor(codePath),
            },
        }),
        functionName: options.functionName,
        environment: options.environment,
        timeout: options.timeout ?? cdk.Duration.seconds(10),
        memorySize: options.memorySize ?? 256,
    });
}
