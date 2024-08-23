import * as core from '@actions/core'
import * as github from '@actions/github'

import { getRepository, createCommitOnBranch } from './github/graphql'
import { isCommit } from './github/types'
import { addFileChanges, getFileChanges } from './git'
import { getInput } from './utils/input'
import {
  NoFileChanges,
  InputFilesRequired,
  InputBranchNotFound,
} from './errors'

export async function run(): Promise<void> {
  try {
    const filePaths = core.getMultilineInput('files', { required: true })
    if (filePaths.length <= 0) throw new InputFilesRequired()

    await addFileChanges(filePaths)
    const fileChanges = await getFileChanges()
    const fileCount =
      (fileChanges.additions?.length ?? 0) +
      (fileChanges.deletions?.length ?? 0)
    if (fileCount <= 0) throw new NoFileChanges()

    const { owner, repo } = github.context.repo
    const branchName = getInput('branch-name')
    const repository = await core.group(
      `fetching repository info for owner: ${owner}, repo: ${repo}, branch: ${branchName}`,
      async () => {
        const startTime = Date.now()
        const repositoryData = await getRepository(owner, repo, branchName)
        const endTime = Date.now()
        core.debug(`time taken: ${(endTime - startTime).toString()} ms`)
        return repositoryData
      }
    )

    if (branchName && !repository.ref) throw new InputBranchNotFound(branchName)

    const targetRef = repository.ref ?? repository.defaultBranchRef
    const commitResponse = await core.group(`committing files`, async () => {
      const startTime = Date.now()
      const target = targetRef?.target.history.nodes?.[0]
      const parentCommit = isCommit(target)
        ? target
        : (() => {
            throw new Error(
              `Unable to locate the parent commit of the branch "${targetRef?.name ?? branchName}"`
            )
          })()

      const commitData = await createCommitOnBranch(
        {
          repositoryNameWithOwner: repository.nameWithOwner,
          branchName: branchName,
        },
        parentCommit,
        fileChanges
      )
      const endTime = Date.now()
      core.debug(`time taken: ${(endTime - startTime).toString()} ms`)
      return commitData
    })

    core.setOutput('commit-sha', commitResponse.commit?.id)
  } catch (error) {
    if (error instanceof NoFileChanges) {
      core.notice('No changes found')
    } else if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      throw error
    }
  }
}
