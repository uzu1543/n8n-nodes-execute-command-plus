import { exec } from 'child_process';
import * as iconv from 'iconv-lite';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

export interface IExecReturnData {
	exitCode: number;
	error?: Error;
	stderr: string;
	stdout: string;
}

/**
 * Promisifiy exec manually to also get the exit code
 *
 */
async function execPromise(command: string, encoding: string): Promise<IExecReturnData> {
	const returnData: IExecReturnData = {
		error: undefined,
		exitCode: 0,
		stderr: '',
		stdout: '',
	};

	return await new Promise((resolve, _reject) => {
		exec(command, { cwd: process.cwd(), encoding: 'binary' }, (error, stdout, stderr) => {
			returnData.stdout = decode(stdout, encoding).trim();
			returnData.stderr = decode(stderr, encoding).trim();

			if (error) {
				returnData.error = error;

				// error.message format: `Command failed: ${cmd}\n${stderr}`
				// cf. https://github.com/nodejs/node/blob/21eac793cd746eab0b36d75af5e16aed11f9aa4b/lib/child_process.js#L417C29-L417C64
				const [msg, ...err] = error.message.split('\n');
				returnData.error.message = `${msg}\n${decode(err.join('\n'), encoding)}`;
			}

			resolve(returnData);
		}).on('exit', (code) => {
			returnData.exitCode = code || 0;
		});
	});
}

function decode(string: string, encoding: string): string {
	return iconv.decode(Buffer.from(string, 'binary'), encoding);
}

export class ExecuteCommandPlus implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Execute Command Plus',
		name: 'executeCommandPlus',
		icon: 'fa:terminal',
		iconColor: 'blue',
		group: ['transform'],
		version: 1,
		description: 'Executes a command on the host',
		defaults: {
			name: 'Execute Command Plus',
			color: '#886644',
		},
		usableAsTool: true,
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		properties: [
			{
				displayName: 'Execute Once',
				name: 'executeOnce',
				type: 'boolean',
				default: true,
				description: 'Whether to execute only once instead of once for each entry',
			},
			{
				displayName: 'Encoding',
				name: 'encoding',
				type: 'string',
				default: 'utf-8',
				required: true,
				description: 'The character encoding the iconv-lite will use',
			},
			{
				displayName: 'Command',
				name: 'command',
				typeOptions: {
					rows: 5,
				},
				type: 'string',
				default: '',
				placeholder: 'echo "test"',
				description: 'The command to execute',
				required: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		let items = this.getInputData();

		let command: string;
		let encoding: string;
		const executeOnce = this.getNodeParameter('executeOnce', 0) as boolean;

		if (executeOnce) {
			items = [items[0]];
		}

		const returnItems: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				command = this.getNodeParameter('command', itemIndex) as string;
				encoding = this.getNodeParameter('encoding', itemIndex) as string;

				if (!iconv.encodingExists(encoding)) {
					throw new NodeOperationError(this.getNode(), `Encoding not recognized: '${encoding}'`, {
						itemIndex,
					});
				}

				const { error, exitCode, stdout, stderr } = await execPromise(command, encoding);

				if (error !== undefined) {
					throw new NodeOperationError(this.getNode(), error.message, { itemIndex });
				}

				returnItems.push({
					json: {
						exitCode,
						stderr,
						stdout,
					},
					pairedItem: {
						item: itemIndex,
					},
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnItems.push({
						json: {
							error: error.message,
						},
						pairedItem: {
							item: itemIndex,
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnItems];
	}
}
